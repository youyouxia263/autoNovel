import React, { useState, useEffect, useRef } from 'react';
import { AppearanceSettings, Chapter, NovelSettings, GrammarIssue, Character } from '../types';
import { Type, AlignLeft, AlignJustify, Moon, Sun, Monitor, ArrowUpDown, Home, ChevronRight, Edit3, Save, X, Sparkles, Loader2, AlertTriangle, FileText, BookOpen, Copy, Check, SpellCheck, PenLine, FileCode } from 'lucide-react';
import { continueWriting, checkGrammar, autoCorrectGrammar } from '../services/geminiService';
import GrammarReport from './GrammarReport';

interface ReaderProps {
  chapter: Chapter | undefined;
  settings: NovelSettings;
  appearance: AppearanceSettings;
  onAppearanceChange: (newSettings: Partial<AppearanceSettings>) => void;
  onGenerate: () => void;
  onBack: () => void;
  onUpdateContent: (id: number, content: string) => void;
  characters?: Character[]; // New prop
}

const Reader: React.FC<ReaderProps> = ({ 
  chapter, 
  settings,
  appearance, 
  onAppearanceChange, 
  onGenerate, 
  onBack,
  onUpdateContent,
  characters = []
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isAiWriting, setIsAiWriting] = useState(false);
  const [streamingContent, setStreamingContent] = useState(''); // Buffer for AI text
  const [copySuccess, setCopySuccess] = useState(false);
  const [mdCopySuccess, setMdCopySuccess] = useState(false);
  
  // Grammar Check State
  const [isCheckingGrammar, setIsCheckingGrammar] = useState(false);
  const [grammarIssues, setGrammarIssues] = useState<GrammarIssue[]>([]);
  const [showGrammarReport, setShowGrammarReport] = useState(false);
  const [isFixingGrammar, setIsFixingGrammar] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);

  // Sync edit content when chapter changes or when entering edit mode
  useEffect(() => {
    if (chapter) {
        setEditContent(chapter.content || '');
        // If chapter changes, exit edit mode
        setIsEditing(false);
        setStreamingContent('');
    }
  }, [chapter?.id, chapter?.content]);

  // Auto-scroll to bottom when AI is writing (streaming) or editing
  useEffect(() => {
    if (isAiWriting) {
        requestAnimationFrame(() => {
             // If in read mode (likely), scroll the div
             if (contentEndRef.current) {
                 contentEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
             }
             // If in edit mode (fallback), scroll textarea
            if (textareaRef.current) {
                textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
            }
        });
    }
  }, [streamingContent, editContent, isAiWriting]);

  const handleStartEdit = () => {
    if (!chapter) return;
    setEditContent(chapter.content || '');
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!chapter) return;
    onUpdateContent(chapter.id, editContent);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(chapter?.content || '');
  };

  const handleAiContinue = async () => {
    if (!chapter) return;
    
    // 1. Prepare context. Use current edit content if available, otherwise chapter content.
    let baseContent = isEditing ? editContent : (chapter.content || '');
    if (baseContent && !baseContent.endsWith('\n')) {
        baseContent += '\n';
    }

    // 2. Switch to view mode to show the fancy streaming styles
    // If we were editing, update the chapter content first so the view mode isn't stale
    if (isEditing) {
        onUpdateContent(chapter.id, baseContent);
    }
    setIsEditing(false);
    setIsAiWriting(true);
    setStreamingContent(''); 

    try {
        // Pass characters to continueWriting
        const stream = continueWriting(baseContent, settings, chapter.title, characters);
        let accumulated = '';
        
        for await (const chunk of stream) {
            accumulated += chunk;
            setStreamingContent(accumulated);
        }

        // 3. Finalize
        const finalContent = baseContent + accumulated;
        setEditContent(finalContent);
        onUpdateContent(chapter.id, finalContent);

    } catch (e: any) {
        console.error("AI writing failed", e);
        alert(`AI assistant encountered an error: ${e.message}`);
    } finally {
        setStreamingContent('');
        setIsAiWriting(false);
    }
  };

  const handleCopy = async () => {
    if (!chapter?.content && !editContent) return;
    const textToCopy = isEditing ? editContent : chapter?.content || '';
    
    try {
        await navigator.clipboard.writeText(textToCopy);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
        console.error('Failed to copy', err);
    }
  };

  const handleCopyMarkdown = async () => {
    if (!chapter?.content && !editContent) return;
    const content = isEditing ? editContent : chapter?.content || '';
    
    // Construct a nice Markdown format
    const markdown = `# ${chapter?.title}\n\n${content}`;
    
    try {
        await navigator.clipboard.writeText(markdown);
        setMdCopySuccess(true);
        setTimeout(() => setMdCopySuccess(false), 2000);
    } catch (err) {
        console.error('Failed to copy markdown', err);
    }
  };

  const handleGrammarCheck = async () => {
      const textToCheck = isEditing ? editContent : chapter?.content;
      if (!textToCheck) return;

      setIsCheckingGrammar(true);
      try {
          const issues = await checkGrammar(textToCheck, settings);
          setGrammarIssues(issues);
          setShowGrammarReport(true);
      } catch (e) {
          console.error("Grammar check failed", e);
          alert("Grammar check failed. Please check connection.");
      } finally {
          setIsCheckingGrammar(false);
      }
  };

  const handleAutoFixGrammar = async () => {
      const textToFix = isEditing ? editContent : chapter?.content;
      if (!chapter || !textToFix) return;

      setIsFixingGrammar(true);
      try {
          const fixed = await autoCorrectGrammar(textToFix, settings);
          if (isEditing) {
              setEditContent(fixed);
          } else {
              onUpdateContent(chapter.id, fixed);
          }
          setShowGrammarReport(false);
      } catch (e) {
          console.error("Auto fix failed", e);
          alert("Auto-fix failed.");
      } finally {
          setIsFixingGrammar(false);
      }
  };

  const getWordCount = (text: string) => {
    if (!text) return 0;
    // Heuristic: for mostly Chinese content, count characters. For English, count words.
    const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
    if (nonAscii > text.length * 0.5) {
        return text.replace(/\s/g, '').length;
    }
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  };

  const getThemeClasses = () => {
    switch (appearance.theme) {
      case 'dark': return 'bg-gray-900 text-gray-300';
      case 'sepia': return 'bg-[#f4ecd8] text-[#5b4636]';
      default: return 'bg-white text-gray-800'; // light
    }
  };

  const getContainerThemeClasses = () => {
    switch (appearance.theme) {
      case 'dark': return 'bg-gray-950 border-gray-800';
      case 'sepia': return 'bg-[#eaddcf] border-[#d3c4b1]';
      default: return 'bg-gray-100 border-gray-200'; // light
    }
  }

  if (!chapter) {
    return (
      <div className={`flex-1 flex items-center justify-center ${getContainerThemeClasses()} h-full`}>
        <div className="text-center p-8 max-w-md">
           <Type className="w-12 h-12 mx-auto mb-4 opacity-20" />
           <p className="text-lg opacity-50">请从左侧选择一个章节以查看或生成内容。</p>
        </div>
      </div>
    );
  }

  const wordCount = getWordCount(isEditing ? editContent : chapter.content);

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden transition-colors duration-300 ${getContainerThemeClasses()}`}>
      
      {/* Toolbar */}
      <div className={`h-14 flex items-center justify-between px-6 border-b shrink-0 transition-colors duration-300 ${
        appearance.theme === 'dark' ? 'bg-gray-900 border-gray-800' : 
        appearance.theme === 'sepia' ? 'bg-[#f4ecd8] border-[#d3c4b1]' : 
        'bg-white border-gray-200'
      }`}>
        <div className="flex items-center overflow-hidden mr-4">
           {/* Breadcrumb */}
           <button 
              onClick={onBack}
              className={`flex items-center hover:opacity-100 transition-colors flex-shrink-0 group ${
                appearance.theme === 'light' ? 'hover:text-indigo-600 opacity-60' : 'opacity-60 hover:opacity-100'
              }`}
              title="返回首页 (Back to Home)"
           >
              <Home size={16} />
              <ChevronRight size={14} className="mx-2 opacity-30 flex-shrink-0" />
              
              <span className="text-sm font-medium opacity-70 truncate max-w-[80px] md:max-w-[200px] hover:underline cursor-pointer" title={settings.title}>
                  {settings.title || "Untitled"}
              </span>
           </button>
           
           <ChevronRight size={14} className="mx-2 opacity-30 flex-shrink-0" />
           
           <span className="font-semibold text-sm opacity-90 flex-shrink-0 whitespace-nowrap">
              第 {chapter.id} 章
           </span>
        </div>

        <div className="flex items-center space-x-2">
            {!isEditing ? (
                <>
                {/* View Mode Controls */}
                <select 
                value={appearance.fontFamily}
                onChange={(e) => onAppearanceChange({ fontFamily: e.target.value as any })}
                className={`hidden md:block text-xs p-1 rounded border-none bg-transparent focus:ring-0 cursor-pointer opacity-70 hover:opacity-100`}
                >
                <option value="font-serif">宋体/Serif</option>
                <option value="font-sans">黑体/Sans</option>
                <option value="font-lora">Lora</option>
                </select>

                <div className="hidden md:flex items-center border-l border-r border-opacity-20 px-2 space-x-1 border-current">
                <button onClick={() => onAppearanceChange({ fontSize: 'text-sm' })} className={`p-1 hover:bg-black/5 rounded ${appearance.fontSize === 'text-sm' ? 'font-bold' : ''}`}>A</button>
                <button onClick={() => onAppearanceChange({ fontSize: 'text-base' })} className={`p-1 hover:bg-black/5 rounded text-lg ${appearance.fontSize === 'text-base' ? 'font-bold' : ''}`}>A</button>
                <button onClick={() => onAppearanceChange({ fontSize: 'text-lg' })} className={`p-1 hover:bg-black/5 rounded text-xl ${appearance.fontSize === 'text-lg' ? 'font-bold' : ''}`}>A</button>
                </div>

                <div className="hidden md:flex items-center border-r border-opacity-20 px-2 space-x-1 border-current" title="行高 (Line Height)">
                <ArrowUpDown size={14} className="opacity-50" />
                <select 
                    value={appearance.lineHeight}
                    onChange={(e) => onAppearanceChange({ lineHeight: e.target.value as any })}
                    className="text-xs p-1 rounded border-none bg-transparent focus:ring-0 cursor-pointer opacity-70 hover:opacity-100"
                    >
                    <option value="leading-tight">紧凑 (Tight)</option>
                    <option value="leading-normal">正常 (Normal)</option>
                    <option value="leading-relaxed">舒适 (Relaxed)</option>
                    <option value="leading-loose">宽松 (Loose)</option>
                    </select>
                </div>

                <div className="hidden md:flex items-center space-x-1 px-2">
                <button onClick={() => onAppearanceChange({ textAlign: 'text-left' })} className={`p-1 rounded hover:bg-black/5 ${appearance.textAlign === 'text-left' ? 'bg-black/10' : ''}`}><AlignLeft size={16}/></button>
                <button onClick={() => onAppearanceChange({ textAlign: 'text-justify' })} className={`p-1 rounded hover:bg-black/5 ${appearance.textAlign === 'text-justify' ? 'bg-black/10' : ''}`}><AlignJustify size={16}/></button>
                </div>

                <div className="flex items-center bg-black/5 rounded-lg p-0.5 ml-2">
                <button onClick={() => onAppearanceChange({ theme: 'light' })} className={`p-1.5 rounded-md ${appearance.theme === 'light' ? 'bg-white shadow-sm text-yellow-600' : 'text-gray-400'}`}><Sun size={14} /></button>
                <button onClick={() => onAppearanceChange({ theme: 'sepia' })} className={`p-1.5 rounded-md ${appearance.theme === 'sepia' ? 'bg-[#eaddcf] shadow-sm text-[#5b4636]' : 'text-gray-400'}`}><Monitor size={14} /></button>
                <button onClick={() => onAppearanceChange({ theme: 'dark' })} className={`p-1.5 rounded-md ${appearance.theme === 'dark' ? 'bg-gray-800 shadow-sm text-indigo-400' : 'text-gray-400'}`}><Moon size={14} /></button>
                </div>

                {chapter.content && !chapter.isGenerating && (
                    <>
                    <div className="h-4 w-px bg-current opacity-20 mx-2"></div>
                    
                    {/* Markdown Copy */}
                    <button
                        onClick={handleCopyMarkdown}
                        className="p-1.5 rounded-md hover:bg-black/5 text-gray-500 hover:text-indigo-600 transition-colors relative group"
                        title="Copy as Markdown"
                    >
                        {mdCopySuccess ? <Check size={16} className="text-green-600" /> : <FileCode size={16} />}
                        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                            Copy Markdown
                        </span>
                    </button>

                    <button
                        onClick={handleCopy}
                        className="p-1.5 rounded-md hover:bg-black/5 text-gray-500 hover:text-indigo-600 transition-colors relative group"
                        title="Copy Text"
                    >
                        {copySuccess ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                         <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                            Copy Text
                        </span>
                    </button>

                     <button
                        onClick={handleGrammarCheck}
                        disabled={isCheckingGrammar}
                        className={`p-1.5 rounded-md hover:bg-black/5 transition-colors ${isCheckingGrammar ? 'text-indigo-400 animate-pulse' : 'text-gray-500 hover:text-indigo-600'}`}
                        title="Check Grammar"
                    >
                        <SpellCheck size={16} />
                    </button>

                    <button 
                        onClick={handleAiContinue}
                        disabled={isAiWriting}
                        className="ml-2 flex items-center space-x-1 bg-purple-50 text-purple-700 border border-purple-200 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-purple-100 transition-colors shadow-sm"
                        title="AI 续写 (Continue Writing)"
                    >
                        <Sparkles size={14} />
                        <span className="hidden sm:inline">AI 续写</span>
                    </button>

                    <button 
                        onClick={handleStartEdit}
                        className="ml-2 flex items-center space-x-1 bg-indigo-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                        <Edit3 size={14} />
                        <span>编辑</span>
                    </button>
                    </>
                )}
                </>
            ) : (
                <div className="flex items-center space-x-2 w-full justify-end">
                     {/* Edit Mode Controls */}
                    <button 
                        onClick={handleAiContinue}
                        disabled={isAiWriting}
                        className="flex items-center space-x-1 bg-purple-100 text-purple-700 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-purple-200 transition-colors mr-auto"
                        title="Let AI continue writing from the end"
                    >
                         {isAiWriting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                         <span>AI 续写 (Continue)</span>
                    </button>

                    <button 
                        onClick={handleCancelEdit}
                        className="flex items-center space-x-1 bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-300 transition-colors"
                    >
                        <X size={14} />
                        <span>取消</span>
                    </button>
                    <button 
                        onClick={handleSaveEdit}
                        className="flex items-center space-x-1 bg-green-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-green-700 transition-colors shadow-sm"
                    >
                        <Save size={14} />
                        <span>保存</span>
                    </button>
                </div>
            )}
        </div>
      </div>

      {/* Editor / Viewer Content Area */}
      <div className="flex-1 relative w-full h-full min-h-0">
        {isEditing ? (
           <textarea
             ref={textareaRef}
             value={editContent}
             onChange={(e) => setEditContent(e.target.value)}
             className={`absolute inset-0 w-full h-full p-8 resize-none outline-none leading-loose ${getThemeClasses()} ${appearance.fontFamily} ${appearance.fontSize}`}
             placeholder="Start writing..."
           />
        ) : (
           <div 
             className={`absolute inset-0 w-full h-full overflow-y-auto p-8 prose max-w-none ${getThemeClasses()} ${appearance.fontFamily} ${appearance.fontSize} ${appearance.textAlign} ${appearance.lineHeight}`}
           >
             {chapter.content || chapter.isGenerating || streamingContent ? (
                <div className="whitespace-pre-wrap max-w-3xl mx-auto pb-20">
                   <h1 className="text-3xl font-bold mb-8 text-center">{chapter.title}</h1>
                   {/* Main Content */}
                   <span>{chapter.content}</span>
                   
                   {/* Streaming Content (Visual Indicator) */}
                   {streamingContent && (
                        <span className={`inline relative ${
                            appearance.theme === 'dark' ? 'text-indigo-300 bg-indigo-900/30' : 'text-indigo-700 bg-indigo-50'
                        } transition-colors duration-200`}>
                            {streamingContent}
                            <span className="inline-block w-2 h-4 ml-1 align-middle bg-indigo-500 animate-pulse rounded-sm"></span>
                        </span>
                   )}
                   
                   {/* Fallback cursor if just waiting */}
                   {(chapter.isGenerating || isAiWriting) && !streamingContent && (
                      <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse">|</span>
                   )}
                   <div ref={contentEndRef} />
                </div>
             ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
                   <div className="p-4 rounded-full bg-gray-100/50">
                      <Sparkles size={32} className="opacity-50" />
                   </div>
                   <p>本章暂无内容 (No content)</p>
                   <button 
                      onClick={onGenerate}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                   >
                      生成内容 (Generate)
                   </button>
                </div>
             )}
           </div>
        )}
      </div>

      {/* Grammar Modal */}
      <GrammarReport 
        isOpen={showGrammarReport}
        onClose={() => setShowGrammarReport(false)}
        issues={grammarIssues}
        onAutoFix={handleAutoFixGrammar}
        isFixing={isFixingGrammar}
      />
    </div>
  );
};

export default Reader;