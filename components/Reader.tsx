import React, { useState, useEffect, useRef } from 'react';
import { AppearanceSettings, Chapter, NovelSettings, GrammarIssue } from '../types';
import { Type, AlignLeft, AlignJustify, Moon, Sun, Monitor, ArrowUpDown, Home, ChevronRight, Edit3, Save, X, Sparkles, Loader2, AlertTriangle, FileText, BookOpen, Copy, Check, SpellCheck, PenLine } from 'lucide-react';
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
}

const Reader: React.FC<ReaderProps> = ({ 
  chapter, 
  settings,
  appearance, 
  onAppearanceChange, 
  onGenerate, 
  onBack,
  onUpdateContent
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isAiWriting, setIsAiWriting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  
  // Grammar Check State
  const [isCheckingGrammar, setIsCheckingGrammar] = useState(false);
  const [grammarIssues, setGrammarIssues] = useState<GrammarIssue[]>([]);
  const [showGrammarReport, setShowGrammarReport] = useState(false);
  const [isFixingGrammar, setIsFixingGrammar] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync edit content when chapter changes or when entering edit mode
  useEffect(() => {
    if (chapter) {
        setEditContent(chapter.content || '');
        // If chapter changes, exit edit mode
        setIsEditing(false);
    }
  }, [chapter?.id, chapter?.content]);

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
    setIsAiWriting(true);
    try {
        const stream = continueWriting(editContent, settings, chapter.title);
        let newContent = editContent;
        // Add a newline if needed
        if (newContent && !newContent.endsWith('\n')) {
            newContent += '\n';
        }
        
        for await (const chunk of stream) {
            newContent += chunk;
            setEditContent(newContent);
            // Scroll to bottom of textarea
            if (textareaRef.current) {
                textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
            }
        }
    } catch (e) {
        console.error("AI writing failed", e);
        alert("AI assistant encountered an error.");
    } finally {
        setIsAiWriting(false);
        // Focus back on textarea after a short delay
        setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
            }
        }, 100);
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
              className={`flex items-center hover:opacity-100 transition-colors flex-shrink-0 ${
                appearance.theme === 'light' ? 'hover:text-indigo-600 opacity-60' : 'opacity-60 hover:opacity-100'
              }`}
              title="返回首页 (Back to Home)"
           >
              <Home size={16} />
           </button>
           
           <ChevronRight size={14} className="mx-2 opacity-30 flex-shrink-0" />
           
           <span className="text-sm font-medium opacity-70 truncate max-w-[80px] md:max-w-[200px]" title={settings.title}>
              {settings.title || "Untitled"}
           </span>
           
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
                    <button
                        onClick={handleCopy}
                        className="p-1.5 rounded-md hover:bg-black/5 text-gray-500 hover:text-indigo-600 transition-colors"
                        title="Copy to Clipboard"
                    >
                        {copySuccess ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
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
                        onClick={() => {
                            handleStartEdit();
                            handleAiContinue();
                        }}
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

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto relative scroll-smooth">
        <div className={`min-h-full max-w-3xl mx-auto py-12 px-8 md:px-12 shadow-sm transition-colors duration-300 ${getThemeClasses()}`}>
            
            <div className="mb-6">
                <h1 className={`text-3xl md:text-4xl font-bold mb-2 ${appearance.fontFamily === 'font-sans' ? 'tracking-tight' : ''}`}>
                {chapter.title}
                </h1>
                <div className="flex items-center space-x-4">
                    <div className="h-1 w-20 bg-indigo-500 rounded-full"></div>
                    {wordCount > 0 && (
                        <div className="flex items-center text-xs opacity-50 space-x-1">
                            <FileText size={12} />
                            <span>{wordCount} 字 (Words)</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Consistency Warning */}
            {chapter.consistencyAnalysis && chapter.consistencyAnalysis !== "Consistent" && (
                <div className="mb-8 p-4 bg-orange-50 border-l-4 border-orange-400 rounded-r-lg">
                    <div className="flex items-start">
                        <AlertTriangle className="h-5 w-5 text-orange-500 mr-2 mt-0.5" />
                        <div>
                            <h4 className="text-sm font-bold text-orange-800">人物一致性校验警告 (Consistency Warning)</h4>
                            <div className="text-sm text-orange-700 mt-1 whitespace-pre-wrap">
                                {chapter.consistencyAnalysis}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Chapter Outline/Summary Display - Shows only when content exists or in edit mode */}
            {chapter.summary && (chapter.content || isEditing) && (
               <div className={`mb-10 p-6 rounded-xl border transition-colors ${
                   appearance.theme === 'dark' ? 'bg-white/5 border-white/10 text-gray-400' : 
                   appearance.theme === 'sepia' ? 'bg-[#e6dcc8] border-[#d3c4b1] text-[#5b4636]' : 
                   'bg-gray-50 border-gray-100 text-gray-600'
               }`}>
                   <div className="flex items-center space-x-2 mb-3 opacity-70">
                       <BookOpen size={14} className="opacity-70" />
                       <span className="text-xs font-bold uppercase tracking-widest">本章大纲 (Outline)</span>
                       <div className="h-px flex-1 bg-current opacity-20"></div>
                   </div>
                   <p className="text-sm leading-relaxed font-serif italic opacity-90">
                       {chapter.summary}
                   </p>
               </div>
            )}

            {isEditing ? (
                 <div className="w-full h-[60vh] md:h-[70vh] relative group">
                    <textarea 
                        ref={textareaRef}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        readOnly={isAiWriting}
                        className={`w-full h-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none bg-transparent ${
                            appearance.theme === 'dark' ? 'text-gray-300 border-gray-700' : 'text-gray-800'
                        } font-mono text-base leading-relaxed transition-opacity ${isAiWriting ? 'opacity-75 cursor-wait' : ''}`}
                        placeholder="Start typing or use AI to generate..."
                    />
                    
                    {/* Visual Feedback Overlay */}
                    {isAiWriting && (
                        <div className="absolute bottom-8 right-8 flex items-center space-x-3 bg-white/95 border border-indigo-100 text-indigo-700 px-5 py-3 rounded-xl shadow-xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-300 z-10">
                             <div className="flex space-x-1.5 items-center">
                                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-[bounce_1s_infinite_0ms]"></div>
                                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-[bounce_1s_infinite_200ms]"></div>
                                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-[bounce_1s_infinite_400ms]"></div>
                             </div>
                             <div className="flex flex-col">
                                <span className="text-sm font-bold">AI 正在创作中...</span>
                                <span className="text-[10px] text-gray-500 font-medium">Writing & Thinking</span>
                             </div>
                             <PenLine size={16} className="text-indigo-400 animate-pulse ml-1" />
                        </div>
                    )}
                 </div>
            ) : chapter.content ? (
              <div className={`
                prose max-w-none 
                ${appearance.fontFamily} 
                ${appearance.fontSize} 
                ${appearance.lineHeight} 
                ${appearance.textAlign}
                ${appearance.theme === 'dark' ? 'prose-invert' : ''}
                whitespace-pre-wrap
              `}>
                {chapter.content}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 space-y-6 opacity-60">
                <div className="text-center max-w-md space-y-2">
                  <h3 className="font-serif text-xl italic">本章摘要</h3>
                  <p className="text-sm leading-relaxed">{chapter.summary}</p>
                </div>
                
                {chapter.isGenerating ? (
                  <div className="flex flex-col items-center space-y-3 animate-pulse">
                     <div className="h-2 w-32 bg-indigo-400 rounded"></div>
                     <div className="h-2 w-48 bg-indigo-400 rounded"></div>
                     <div className="h-2 w-40 bg-indigo-400 rounded"></div>
                     <span className="text-sm font-medium text-indigo-500 mt-2">正在撰写章节...</span>
                  </div>
                ) : (
                  <button 
                    onClick={onGenerate}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-md transition-all transform hover:scale-105 active:scale-95 font-medium flex items-center space-x-2"
                  >
                    <Type size={16} />
                    <span>生成本章内容</span>
                  </button>
                )}
              </div>
            )}

            {/* Bottom spacer */}
            <div className="h-20"></div>
        </div>
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