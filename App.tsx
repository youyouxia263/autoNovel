
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { NovelState, NovelSettings, AppearanceSettings, Chapter, Character } from './types';
import * as GeminiService from './services/geminiService';
import { DAOFactory } from './services/dao'; 
import SettingsForm from './components/SettingsForm';
import Reader from './components/Reader';
import CharacterList from './components/CharacterList';
import ConsistencyReport from './components/ConsistencyReport';
import AppSidebar, { ViewType } from './components/AppSidebar';
import ModelConfigManager from './components/ModelConfigManager';
import PromptConfigManager from './components/PromptConfigManager';
import StorageConfigManager from './components/StorageConfigManager';
import LanguageConfigManager from './components/LanguageConfigManager';
import { Menu, ChevronRight, CheckCircle2, Circle, Download, FileText, Printer, Sparkles, Users, FileSearch, BookOpen, Gauge, Database, Loader2, Cloud, Clock } from 'lucide-react';

// Initial default settings factory
const getDefaultSettings = (): NovelSettings => ({
  title: '',
  premise: '',
  mainCategory: '',
  themes: [],
  roles: [],
  plots: [],
  novelType: 'long',
  targetWordCount: 10000, 
  chapterCount: 5,
  language: 'zh', 
  provider: 'gemini',
  apiKey: '',
  modelName: '',
  worldSetting: '', 
  // Default Style Settings
  writingTone: 'Neutral',
  writingStyle: 'Moderate',
  narrativePerspective: 'Third Person Limited',
  maxOutputTokens: undefined, 
  storage: { type: 'sqlite' },
  customPrompts: {}
});

const DEFAULT_APPEARANCE: AppearanceSettings = {
  fontFamily: 'font-serif',
  fontSize: 'text-base',
  lineHeight: 'leading-loose',
  textAlign: 'text-left',
  theme: 'light',
};

// Helper for word count
const getWordCount = (text: string) => {
    if (!text) return 0;
    const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
    if (nonAscii > text.length * 0.5) {
        return text.replace(/\s/g, '').length;
    }
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
};

const App: React.FC = () => {
  // --- View State ---
  const [currentView, setCurrentView] = useState<ViewType>('workspace');

  // --- Novel State ---
  const [state, setState] = useState<NovelState>({
    settings: getDefaultSettings(),
    chapters: [],
    characters: [],
    currentChapterId: null,
    status: 'idle',
    consistencyReport: null,
    usage: { inputTokens: 0, outputTokens: 0 }
  });

  const [appearance, setAppearance] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [sidebarOpen, setSidebarOpen] = useState(true); 
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showCharacterModal, setShowCharacterModal] = useState(false);
  const [showConsistencyReport, setShowConsistencyReport] = useState(false);
  const [isCheckingConsistency, setIsCheckingConsistency] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastAutoSaveTime, setLastAutoSaveTime] = useState<Date | null>(null);
  
  // Library State
  const [savedNovels, setSavedNovels] = useState<{id: string, title: string, updatedAt: Date}[]>([]);

  // Refs
  const settingsRef = useRef(state.settings);
  const abortControllerRef = useRef<AbortController | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    settingsRef.current = state.settings;
  }, [state.settings]);

  // --- Persistence Logic ---
  
  const refreshLibrary = async () => {
      // Use current settings for DAO connection info if possible, or defaults
      const dao = DAOFactory.getDAO(state.settings.storage.type === 'mysql' ? state.settings : getDefaultSettings());
      try {
          const novels = await dao.listNovels();
          setSavedNovels(novels.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
      } catch (e) {
          console.error("Failed to list novels", e);
      }
  };

  useEffect(() => {
      refreshLibrary();
  }, []);

  const handleLoadNovel = async (id: string) => {
      if (state.status === 'generating_outline') return;
      
      const dao = DAOFactory.getDAO(state.settings); // Use current config to load, assuming same storage
      try {
          const loaded = await dao.loadNovel(id);
          if (loaded) {
              // Ensure status is 'ready' if chapters exist so the reader view is shown
              if (loaded.chapters && loaded.chapters.length > 0 && loaded.status === 'idle') {
                  loaded.status = 'ready';
              }
              
              // Helper to migrate old settings if they exist
              const loadedSettings = loaded.settings as any;
              if (loadedSettings.genre && Array.isArray(loadedSettings.genre) && !loadedSettings.mainCategory) {
                 // Migration: If old generic 'genre' array exists but no 'mainCategory', map it simply.
                 loaded.settings.mainCategory = loadedSettings.genre[0] || '玄幻';
                 loaded.settings.themes = [];
                 loaded.settings.roles = [];
                 loaded.settings.plots = [];
              }
              
              setState(loaded);
              setLastAutoSaveTime(new Date());
              setSidebarOpen(true);
              setCurrentView('workspace'); // Ensure view switches to workspace
          }
      } catch (e) {
          console.error("Failed to load novel", e);
          alert("Failed to load novel.");
      }
  };

  const handleDeleteNovel = async (id: string) => {
      if (!window.confirm("Are you sure you want to delete this novel?")) return;
      const dao = DAOFactory.getDAO(state.settings);
      await dao.deleteNovel(id);
      await refreshLibrary();
      
      if (state.settings.id === id) {
          handleCreateNew();
      }
  };

  const performSave = async (currentState: NovelState, isAuto: boolean = false) => {
      if (!currentState.settings.title) return; 
      
      if (!isAuto) setIsSaving(true);

      try {
          const dao = DAOFactory.getDAO(currentState.settings);
          const id = await dao.saveNovel(currentState);
          
          // If we just saved a new novel for the first time, update state with ID
          if (currentState.settings.id !== id) {
              setState(prev => ({
                  ...prev,
                  settings: { ...prev.settings, id }
              }));
          }
          
          setLastAutoSaveTime(new Date());
          await refreshLibrary();
          
      } catch (e) {
          console.error("Save failed", e);
          if (!isAuto) alert("保存失败 (Save Failed): " + (e as Error).message);
      } finally {
          if (!isAuto) setIsSaving(false);
      }
  };

  const handleManualSave = () => performSave(state, false);

  // Auto-save Effect
  useEffect(() => {
      // Don't auto-save if we haven't started (no title) or are in initial setup
      if (!state.settings.title) return;

      if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
      }

      // Debounce auto-save by 3 seconds
      autoSaveTimerRef.current = setTimeout(() => {
          performSave(state, true);
      }, 3000);

      return () => {
          if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      };
  }, [state]);

  const handleCreateNew = () => {
      if (state.status === 'ready' && state.chapters.some(c => c.isDone || c.content)) {
        if (!window.confirm("Creating new novel will close current one. Unsaved progress might be lost (Auto-save is on). Continue?")) {
            return;
        }
      }
      
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
      }

      setState({
        settings: getDefaultSettings(),
        chapters: [],
        characters: [],
        currentChapterId: null,
        status: 'idle',
        usage: { inputTokens: 0, outputTokens: 0 }
      });
      setLastAutoSaveTime(null);
      setSidebarOpen(true);
      setCurrentView('workspace');
  };

  const totalWordCount = state.chapters.reduce((acc, c) => acc + getWordCount(c.content || ''), 0);

  const handleUsageUpdate = (usage: { input: number; output: number }) => {
    setState(prev => ({
        ...prev,
        usage: {
            inputTokens: prev.usage.inputTokens + usage.input,
            outputTokens: prev.usage.outputTokens + usage.output
        }
    }));
  };

  const handleSettingsChange = (newSettings: NovelSettings) => {
    setState(prev => ({ ...prev, settings: newSettings }));
  };

  const handleAppearanceChange = (newAppearance: Partial<AppearanceSettings>) => {
    setAppearance(prev => ({ ...prev, ...newAppearance }));
  };

  const handleUpdateChapter = (chapterId: number, newContent: string) => {
    setState(prev => {
        const nextChapters = prev.chapters.map(c => 
            c.id === chapterId ? { ...c, content: newContent, isDone: true } : c
        );
        return { ...prev, chapters: nextChapters };
    });
  };

  const handleUpdateCharacters = (newCharacters: Character[]) => {
      setState(prev => ({ ...prev, characters: newCharacters }));
  };

  const generateOutlineAndCharacters = async () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setState(prev => ({ ...prev, status: 'generating_outline' }));
    
    try {
      const [outline, characters] = await Promise.all([
         GeminiService.generateOutline(settingsRef.current, controller.signal, handleUsageUpdate),
         GeminiService.generateCharacters(settingsRef.current, controller.signal, handleUsageUpdate)
      ]);
      
      const newChapters: Chapter[] = outline.map(c => ({
        ...c,
        content: '',
        isGenerating: false,
        isDone: false
      }));

      setState(prev => ({
        ...prev,
        chapters: newChapters,
        characters: characters,
        status: 'ready',
        currentChapterId: newChapters[0]?.id || null
      }));
      
      // Initial save after generation
      setTimeout(() => performSave(state, true), 1000);

    } catch (error: any) {
      if (error.name === 'AbortError' || error.message?.includes('Aborted')) {
          console.log("Generation stopped by user.");
          setState(prev => ({ ...prev, status: 'idle' }));
      } else {
          console.error("Generation failed", error);
          alert(`Failed to generate outline or characters: ${error.message || "Unknown Error"}`);
          setState(prev => ({ ...prev, status: 'idle' }));
      }
    } finally {
        abortControllerRef.current = null;
    }
  };

  const handleStopOutlineGeneration = () => {
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
      }
      setState(prev => ({ ...prev, status: 'idle' }));
  };

  const selectChapter = (id: number) => {
    setState(prev => ({ ...prev, currentChapterId: id }));
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  const generateChapterContent = async () => {
    const chapterId = state.currentChapterId;
    if (!chapterId) return;

    const chapterIndex = state.chapters.findIndex(c => c.id === chapterId);
    if (chapterIndex === -1) return;

    const chapter = state.chapters[chapterIndex];
    if (chapter.isDone || chapter.isGenerating) return;

    const previousChapters = state.chapters.filter(c => c.isDone && c.id < chapterId);
    const storySummaries = previousChapters
        .map(c => `Chapter ${c.id}: ${c.summary}`)
        .join("\n");

    let previousChapterContent = "";
    if (previousChapters.length > 0) {
        const last = previousChapters[previousChapters.length - 1];
        if (last.id === chapterId - 1) {
             previousChapterContent = (last.content || "").slice(-8000);
        }
    }

    setState(prev => {
      const newChapters = [...prev.chapters];
      newChapters[chapterIndex] = { ...chapter, isGenerating: true, content: '' };
      return { ...prev, chapters: newChapters };
    });

    try {
      const stream = GeminiService.generateChapterStream(
          settingsRef.current, 
          chapter, 
          storySummaries, 
          previousChapterContent,
          state.characters, 
          handleUsageUpdate
      );
      
      let fullContent = '';
      
      for await (const chunk of stream) {
        fullContent += chunk;
        setState(prev => {
          const nextChapters = [...prev.chapters];
          const idx = nextChapters.findIndex(c => c.id === chapterId);
          if (idx !== -1) {
            nextChapters[idx] = { 
              ...nextChapters[idx], 
              content: fullContent 
            };
          }
          return { ...prev, chapters: nextChapters };
        });
      }

      let finalSummary = chapter.summary;
      try {
        const generatedSummary = await GeminiService.summarizeChapter(
          fullContent, 
          settingsRef.current, 
          handleUsageUpdate
        );
        if (generatedSummary) {
          finalSummary = generatedSummary;
        }
      } catch (err) {
        console.error("Failed to generate summary", err);
      }

      setState(prev => {
        const nextChapters = [...prev.chapters];
        const idx = nextChapters.findIndex(c => c.id === chapterId);
        if (idx !== -1) {
          nextChapters[idx] = { 
            ...nextChapters[idx], 
            content: fullContent,
            summary: finalSummary,
            isGenerating: false, 
            isDone: true 
          };
        }
        return { ...prev, chapters: nextChapters };
      });
      
      // Auto-save after chapter generation
      setTimeout(() => performSave(state, true), 100);

    } catch (error: any) {
      console.error("Chapter generation error", error);
      alert(`Error generating chapter content: ${error.message || "Check API Key"}`);
       setState(prev => {
        const newChapters = [...prev.chapters];
        const idx = newChapters.findIndex(c => c.id === chapterId);
        if (idx !== -1) {
          newChapters[idx] = { ...newChapters[idx], isGenerating: false };
        }
        return { ...prev, chapters: newChapters };
      });
    }
  };

  const handleAutoGenerate = async () => {
    if (state.chapters.every(c => c.isDone)) {
        if (window.confirm("所有章节已完成。要重新生成所有章节吗？\nAll chapters are done. Do you want to rewrite all?")) {
           handleRewriteAll();
        }
        return;
    }

    let cumulativeSummaries = "";
    const alreadyDone = state.chapters.filter(c => c.isDone);
    cumulativeSummaries = alreadyDone.map(c => `Chapter ${c.id}: ${c.summary}`).join("\n");
    
    let previousChapterContent = "";
    if (alreadyDone.length > 0) {
        const last = alreadyDone[alreadyDone.length - 1];
        previousChapterContent = (last.content || "").slice(-8000);
    }

    for (let i = 0; i < state.chapters.length; i++) {
        const chapter = state.chapters[i];

        if (chapter.isDone) {
             if (!cumulativeSummaries.includes(`Chapter ${chapter.id}:`)) {
                 cumulativeSummaries += `\nChapter ${chapter.id}: ${chapter.summary}`;
             }
             previousChapterContent = (chapter.content || "").slice(-8000);
             continue;
        }

        if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 3000)); 
        }

        setState(prev => {
            const nextChapters = [...prev.chapters];
            nextChapters[i] = { ...nextChapters[i], isGenerating: true };
            return { ...prev, chapters: nextChapters, currentChapterId: nextChapters[i].id };
        });

        try {
            let fullContent = "";
            const stream = GeminiService.generateChapterStream(
                settingsRef.current, 
                chapter, 
                cumulativeSummaries,
                previousChapterContent,
                state.characters, 
                handleUsageUpdate
            );
            
            for await (const chunk of stream) {
                fullContent += chunk;
                setState(prev => {
                    const nextChapters = [...prev.chapters];
                    nextChapters[i] = { ...nextChapters[i], content: fullContent };
                    return { ...prev, chapters: nextChapters };
                });
            }

            let summary = chapter.summary;
            try {
                 const genSummary = await GeminiService.summarizeChapter(fullContent, settingsRef.current, handleUsageUpdate); 
                 if (genSummary) summary = genSummary;
            } catch (e) { console.error(e) }

            setState(prev => {
                const nextChapters = [...prev.chapters];
                nextChapters[i] = { 
                    ...nextChapters[i], 
                    content: fullContent, 
                    summary: summary,
                    isGenerating: false, 
                    isDone: true 
                };
                return { ...prev, chapters: nextChapters };
            });

            cumulativeSummaries += `\nChapter ${chapter.id}: ${summary}`;
            previousChapterContent = fullContent.slice(-8000);
            
            // Auto save after each chapter in auto-mode
            await performSave(state, true);

        } catch (error: any) {
            console.error("Auto generation failed at chapter " + chapter.id, error);
            setState(prev => {
                const nextChapters = [...prev.chapters];
                nextChapters[i] = { ...nextChapters[i], isGenerating: false };
                return { ...prev, chapters: nextChapters };
            });
            alert(`Auto-generation paused at Chapter ${chapter.id}: ${error.message || "Network/API Error"}`);
            break; 
        }
    }
  };

  const handleRewriteAll = async () => {
    if (!window.confirm("确定要重写所有章节吗？这将覆盖现有内容。\nAre you sure you want to rewrite all chapters? This will overwrite existing content.")) return;
    
    const chaptersToRewrite = state.chapters.map(c => ({
        ...c, 
        content: '', 
        summary: c.summary,
        isDone: false,
        isGenerating: false,
        consistencyAnalysis: undefined
    }));
    
    setState(prev => ({ ...prev, chapters: chaptersToRewrite, currentChapterId: chaptersToRewrite[0].id }));
    
    let cumulativeSummaries = "";
    let previousChapterContent = "";
    
    for (let i = 0; i < chaptersToRewrite.length; i++) {
        const chapterConfig = chaptersToRewrite[i]; 
        
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 3000));

        setState(prev => {
            const nextChapters = [...prev.chapters];
            nextChapters[i] = { ...nextChapters[i], isGenerating: true };
            return { ...prev, chapters: nextChapters, currentChapterId: nextChapters[i].id };
        });
        
        let fullContent = "";
        try {
            const stream = GeminiService.generateChapterStream(
                settingsRef.current, 
                chapterConfig, 
                cumulativeSummaries,
                previousChapterContent,
                state.characters, 
                handleUsageUpdate
            );

            for await (const chunk of stream) {
                fullContent += chunk;
                setState(prev => {
                    const nextChapters = [...prev.chapters];
                    nextChapters[i] = { ...nextChapters[i], content: fullContent };
                    return { ...prev, chapters: nextChapters };
                });
            }
            
            const summary = await GeminiService.summarizeChapter(fullContent, settingsRef.current, handleUsageUpdate); 
            
            setState(prev => {
                const nextChapters = [...prev.chapters];
                nextChapters[i] = { 
                    ...nextChapters[i], 
                    content: fullContent, 
                    summary: summary,
                    isGenerating: false, 
                    isDone: true 
                };
                return { ...prev, chapters: nextChapters };
            });
            
            cumulativeSummaries += `\nChapter ${chapterConfig.id}: ${summary}`;
            previousChapterContent = fullContent.slice(-8000);
            
        } catch (e: any) {
            console.error(e);
             setState(prev => {
                 const nextChapters = [...prev.chapters];
                 nextChapters[i] = { ...nextChapters[i], isGenerating: false };
                 return { ...prev, chapters: nextChapters };
            });
            alert(`Error generating Chapter ${chapterConfig.id}: ${e.message}`);
            break; 
        }
    }
    performSave(state, true);
  };

  const handleConsistencyCheck = async () => {
    if (state.characters.length === 0) {
        alert("Character profiles not found. Cannot check consistency.");
        return;
    }

    setIsCheckingConsistency(true);
    let issueCount = 0;

    for (let i = 0; i < state.chapters.length; i++) {
        const chapter = state.chapters[i];
        if (!chapter.isDone || !chapter.content) continue;

        const analysis = await GeminiService.checkConsistency(chapter.content, state.characters, settingsRef.current, handleUsageUpdate); 
        
        setState(prev => {
            const nextChapters = [...prev.chapters];
            nextChapters[i] = { ...nextChapters[i], consistencyAnalysis: analysis };
            return { ...prev, chapters: nextChapters };
        });

        if (analysis !== "Consistent") issueCount++;
    }

    setIsCheckingConsistency(false);
    setShowConsistencyReport(true);
  };

  const handleFixConsistency = async (chapterId: number) => {
    const chapter = state.chapters.find(c => c.id === chapterId);
    if (!chapter || !chapter.consistencyAnalysis) return;

    setState(prev => {
        const nextChapters = prev.chapters.map(c => 
            c.id === chapterId ? { ...c, isGenerating: true } : c
        );
        return { ...prev, chapters: nextChapters };
    });

    try {
        const fixedContent = await GeminiService.fixChapterConsistency(
            chapter.content,
            state.characters,
            chapter.consistencyAnalysis,
            settingsRef.current, 
            handleUsageUpdate
        );

        setState(prev => {
            const nextChapters = prev.chapters.map(c => 
                c.id === chapterId ? { 
                    ...c, 
                    content: fixedContent, 
                    isGenerating: false,
                    consistencyAnalysis: "Fixed (Manual check recommended)" 
                } : c
            );
            return { ...prev, chapters: nextChapters };
        });
    } catch (e) {
        console.error("Failed to fix consistency", e);
        alert("Auto-fix failed. Please check connection.");
        setState(prev => {
            const nextChapters = prev.chapters.map(c => 
                c.id === chapterId ? { ...c, isGenerating: false } : c
            );
            return { ...prev, chapters: nextChapters };
        });
    }
  };

  const handleExportText = () => {
    const lines = [];
    lines.push(state.settings.title);
    lines.push("=".repeat(state.settings.title.length * 2));
    lines.push(`\nPremise/Intro:\n${state.settings.premise}\n`);
    lines.push(`Total Words: ${totalWordCount}`);
    
    state.chapters.forEach(chapter => {
      lines.push("\n\n" + "#".repeat(20));
      lines.push(`Chapter ${chapter.id}: ${chapter.title}`);
      lines.push("#".repeat(20) + "\n");
      lines.push(chapter.content || "(Content not generated yet)");
    });

    const text = lines.join("\n");
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.settings.title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const handleExportPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert("Please allow popups to export PDF.");
      return;
    }

    const title = state.settings.title || "Novel";
    
    const contentHtml = state.chapters.map(c => `
      <div class="chapter">
        <h2>Chapter ${c.id}: ${c.title}</h2>
        <div class="content">${(c.content || '(Content not generated yet)').replace(/\n/g, '<br/>')}</div>
      </div>
      <div class="page-break"></div>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          body { 
            font-family: 'Times New Roman', "SimSun", "Songti SC", serif; 
            padding: 40px; 
            max-width: 800px; 
            margin: 0 auto; 
            color: #000;
          }
          h1 { text-align: center; margin-bottom: 20px; font-size: 2em; }
          .meta { text-align: center; color: #666; margin-bottom: 30px; }
          .premise { font-style: italic; margin-bottom: 40px; color: #444; border-left: 3px solid #ddd; padding-left: 15px; }
          .chapter { margin-bottom: 40px; }
          h2 { border-bottom: 1px solid #eee; padding-bottom: 10px; margin-top: 30px; }
          .content { line-height: 1.8; text-align: justify; white-space: pre-wrap; font-size: 1.1em; }
          .page-break { page-break-after: always; }
          @media print {
             body { padding: 0; }
            .page-break { page-break-after: always; }
          }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <div class="meta">Word Count: ${totalWordCount}</div>
        <div class="premise">${state.settings.premise}</div>
        <hr style="margin: 30px 0; border: 0; border-top: 1px solid #ccc;" />
        ${contentHtml}
        <script>
          window.onload = () => { setTimeout(() => window.print(), 500); }
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    setShowExportMenu(false);
  };

  const currentChapter = state.chapters.find(c => c.id === state.currentChapterId);

  // --- Main Render Content Logic ---
  let mainContent;
  
  if (currentView === 'settings-model') {
      mainContent = (
          <ModelConfigManager 
            settings={state.settings}
            onSettingsChange={handleSettingsChange}
          />
      );
  } else if (currentView === 'settings-prompt') {
      mainContent = (
          <PromptConfigManager 
            settings={state.settings}
            onSettingsChange={handleSettingsChange}
          />
      );
  } else if (currentView === 'settings-storage') {
      mainContent = (
          <StorageConfigManager
            settings={state.settings}
            onSettingsChange={handleSettingsChange}
          />
      );
  } else if (currentView === 'settings-language') {
      mainContent = (
          <LanguageConfigManager
            settings={state.settings}
            onSettingsChange={handleSettingsChange}
          />
      );
  } else if (state.status === 'idle' || state.status === 'generating_outline') {
      mainContent = (
         <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
            <header className="bg-white border-b border-gray-200 py-4 px-6 flex items-center justify-between shrink-0">
                <div className="flex items-center space-x-2">
                    <h1 className="text-xl font-serif font-bold text-gray-800">
                        {state.settings.id ? '编辑设定 (Edit Settings)' : '新作品设定 (New Novel)'}
                    </h1>
                </div>
            </header>
            <main className="flex-1">
                <SettingsForm 
                    settings={state.settings}
                    onSettingsChange={handleSettingsChange}
                    onSubmit={generateOutlineAndCharacters}
                    onStop={handleStopOutlineGeneration}
                    isLoading={state.status === 'generating_outline'}
                />
            </main>
        </div>
      );
  } else {
      mainContent = (
          <div className="flex flex-1 h-full overflow-hidden">
                <div 
                    className={`${
                    sidebarOpen ? 'w-72 translate-x-0' : 'w-0 -translate-x-full'
                    } bg-white border-r border-gray-200 transition-all duration-300 ease-in-out flex flex-col flex-shrink-0 relative z-20 h-full shadow-sm`}
                >
                    <div className="p-4 border-b border-gray-100 bg-gray-50 flex flex-col space-y-2">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-gray-700 font-sans">目录 (Table of Contents)</h3>
                            <button onClick={() => setSidebarOpen(false)} className="md:hidden p-1 text-gray-500">
                                <ChevronRight className="rotate-180" />
                            </button>
                        </div>
                        <div className="text-xs text-gray-500 bg-white px-2 py-1 rounded border border-gray-100 flex justify-between">
                            <span>总字数 (Total):</span>
                            <span className="font-mono font-medium">{totalWordCount}</span>
                        </div>
                    </div>
                    
                    <div className="px-4 py-2 border-b border-gray-100 bg-indigo-50/50">
                        <div className="flex items-center justify-between text-[10px] text-gray-600">
                            <div className="flex items-center space-x-1" title="Input Tokens">
                                <Gauge size={10} className="text-indigo-500" />
                                <span>In: {state.usage.inputTokens.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center space-x-1" title="Output Tokens">
                                <Gauge size={10} className="text-green-500" />
                                <span>Out: {state.usage.outputTokens.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>

                    <div className="px-4 py-3 border-b border-gray-100 bg-white shrink-0">
                        <div className="flex items-center space-x-2 text-gray-700 mb-1">
                            <BookOpen size={12} />
                            <span className="text-xs font-bold">故事概要 (Premise)</span>
                        </div>
                        <p className="text-[10px] text-gray-500 leading-relaxed line-clamp-3 hover:line-clamp-none transition-all cursor-default" title={state.settings.premise}>
                            {state.settings.premise}
                        </p>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto py-2">
                        {state.chapters.map((chapter) => (
                            <button
                            key={chapter.id}
                            onClick={() => selectChapter(chapter.id)}
                            className={`w-full text-left px-5 py-3 border-l-4 transition-colors ${
                                state.currentChapterId === chapter.id
                                ? 'bg-indigo-50 border-indigo-500'
                                : 'border-transparent hover:bg-gray-50'
                            }`}
                            >
                            <div className="flex items-start justify-between">
                                <div className="overflow-hidden">
                                <span className={`text-xs font-bold uppercase tracking-wider mb-0.5 block ${state.currentChapterId === chapter.id ? 'text-indigo-600' : 'text-gray-400'}`}>
                                    第 {chapter.id} 章
                                </span>
                                <span className={`text-sm font-medium block truncate w-48 ${state.currentChapterId === chapter.id ? 'text-gray-900' : 'text-gray-700'}`}>
                                    {chapter.title}
                                </span>
                                {chapter.content && (
                                    <span className="text-[10px] text-gray-400 mt-0.5 block">
                                        {getWordCount(chapter.content)} 字
                                    </span>
                                )}
                                </div>
                                <div className="mt-1 flex items-center space-x-1">
                                {chapter.isGenerating ? (
                                    <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin"></div>
                                ) : chapter.isDone ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                                ) : (
                                    <Circle className="w-4 h-4 text-gray-300" />
                                )}
                                </div>
                            </div>
                            </button>
                        ))}
                    </div>

                    <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-3">
                        <div className="grid grid-cols-4 gap-1">
                            <button 
                            onClick={() => setShowCharacterModal(true)}
                            className="flex flex-col items-center justify-center text-gray-600 hover:text-indigo-600 text-[10px] font-medium py-2 rounded-lg transition-colors border border-transparent hover:bg-gray-100"
                            title="查看人物 (View Characters)"
                            >
                            <Users size={16} className="mb-1" />
                            <span>人物</span>
                            </button>

                            <button 
                            onClick={handleConsistencyCheck}
                            disabled={isCheckingConsistency}
                            className={`flex flex-col items-center justify-center text-[10px] font-medium py-2 rounded-lg transition-colors border border-transparent hover:bg-orange-50 ${isCheckingConsistency ? 'text-gray-300' : 'text-orange-600 hover:text-orange-800'}`}
                            title="一键校验人物一致性 (Check Consistency)"
                            >
                            <FileSearch size={16} className={`mb-1 ${isCheckingConsistency ? 'animate-pulse' : ''}`} />
                            <span>校验</span>
                            </button>

                            <button 
                            onClick={handleAutoGenerate}
                            className="flex flex-col items-center justify-center text-indigo-600 hover:text-indigo-800 text-[10px] font-medium py-2 rounded-lg transition-colors border border-transparent hover:bg-indigo-50"
                            title="自动生成剩余章节"
                            >
                            <Sparkles size={16} className="mb-1" />
                            <span>生成</span>
                            </button>
                            
                            <button 
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            className="flex flex-col items-center justify-center text-gray-600 hover:text-indigo-600 text-[10px] font-medium py-2 rounded-lg transition-colors border border-transparent hover:bg-gray-100 relative"
                            title="导出 (Export)"
                            >
                            <Download size={16} className="mb-1" />
                            <span>导出</span>
                            {showExportMenu && (
                            <div className="absolute bottom-full right-0 w-32 mb-2 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50">
                                <div onClick={(e) => { e.stopPropagation(); handleExportText(); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center space-x-2 text-xs text-gray-700 cursor-pointer">
                                <FileText size={14} />
                                <span>Text (.txt)</span>
                                </div>
                                <div onClick={(e) => { e.stopPropagation(); handleExportPDF(); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center space-x-2 text-xs text-gray-700 border-t border-gray-100 cursor-pointer">
                                <Printer size={14} />
                                <span>PDF (.pdf)</span>
                                </div>
                            </div>
                            )}
                            </button>
                        </div>
                        
                        <div className="text-xs pt-2 border-t border-gray-200 flex flex-col space-y-2">
                             <div className="flex justify-between items-center text-gray-400">
                                <p className="truncate font-medium text-gray-500 max-w-[120px]" title={state.settings.title}>{state.settings.title}</p>
                                <button 
                                    onClick={handleManualSave}
                                    disabled={isSaving}
                                    className="flex items-center space-x-1 hover:text-emerald-600 transition-colors"
                                    title="Manual Save"
                                >
                                {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
                                <span className="text-[10px]">{isSaving ? 'Saving...' : 'Save'}</span>
                                </button>
                             </div>
                             {lastAutoSaveTime && (
                                 <div className="flex items-center justify-end space-x-1 text-[9px] text-gray-400">
                                     <Clock size={10} />
                                     <span>Auto-saved: {lastAutoSaveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                 </div>
                             )}
                        </div>
                    </div>
                </div>

                {!sidebarOpen && (
                <button 
                    onClick={() => setSidebarOpen(true)}
                    className="absolute left-4 top-4 z-30 p-2 bg-white rounded-full shadow-md text-gray-600 hover:text-indigo-600 transition-colors"
                >
                    <Menu size={20} />
                </button>
                )}

                <Reader 
                    chapter={currentChapter}
                    settings={state.settings}
                    appearance={appearance}
                    onAppearanceChange={handleAppearanceChange}
                    onGenerate={generateChapterContent}
                    onBack={handleCreateNew}
                    onUpdateContent={handleUpdateChapter}
                    characters={state.characters}
                />
          </div>
      );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-100">
      
      <AppSidebar 
        novels={savedNovels}
        currentNovelId={state.settings.id}
        onSelect={handleLoadNovel}
        onCreate={handleCreateNew}
        onDelete={handleDeleteNovel}
        settings={state.settings}
        onSettingsChange={handleSettingsChange}
        currentView={currentView}
        onNavigate={setCurrentView}
      />

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col h-full relative overflow-hidden">
        {mainContent}
        
        {/* Modals */}
        <CharacterList 
            characters={state.characters} 
            isOpen={showCharacterModal} 
            onClose={() => setShowCharacterModal(false)}
            onUpdateCharacters={handleUpdateCharacters}
            settings={state.settings} 
        />
        <ConsistencyReport 
            chapters={state.chapters}
            isOpen={showConsistencyReport}
            onClose={() => setShowConsistencyReport(false)}
            onFixConsistency={handleFixConsistency}
        />
      </div>

    </div>
  );
};

export default App;
