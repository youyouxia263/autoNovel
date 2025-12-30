import React, { useState } from 'react';
import { NovelSettings, Genre, Language, ModelProvider, WritingTone, WritingStyle, NarrativePerspective, NovelType } from '../types';
import { BookOpen, PenTool, Sparkles, Globe, Wand2, Loader2, Bot, Key, Server, Feather, Eye, Mic2, Link, ScrollText, BookCopy, Globe2, Dna, Check, Square, Gauge, Users } from 'lucide-react';
import { generatePremise, generateWorldSetting, expandText, generateCharacterConcepts } from '../services/geminiService';

interface SettingsFormProps {
  settings: NovelSettings;
  onSettingsChange: (settings: NovelSettings) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isLoading: boolean;
}

const GENRE_LABELS: Record<Genre, string> = {
  [Genre.Suspense]: '悬疑 (Suspense)',
  [Genre.Romance]: '言情 (Romance)',
  [Genre.Thriller]: '惊悚 (Thriller)',
  [Genre.Mystery]: '推理 (Mystery)',
  [Genre.Fantasy]: '玄幻 (Fantasy)',
  [Genre.SciFi]: '科幻 (Sci-Fi)',
  [Genre.TimeTravel]: '穿越 (Time Travel)',
  [Genre.Rebirth]: '重生 (Rebirth)',
  [Genre.Urban]: '都市 (Urban)',
  [Genre.Wuxia]: '武侠/仙侠 (Wuxia)',
  [Genre.System]: '系统 (System)',
};

const SettingsForm: React.FC<SettingsFormProps> = ({ settings, onSettingsChange, onSubmit, onStop, isLoading }) => {
  const [isGeneratingPremise, setIsGeneratingPremise] = useState(false);
  const [isExpandingPremise, setIsExpandingPremise] = useState(false);
  
  const [isGeneratingWorld, setIsGeneratingWorld] = useState(false);
  const [isExpandingWorld, setIsExpandingWorld] = useState(false);

  const [isGeneratingCharacters, setIsGeneratingCharacters] = useState(false);
  const [isExpandingCharacters, setIsExpandingCharacters] = useState(false);
  
  const handleChange = (field: keyof NovelSettings, value: any) => {
    onSettingsChange({ ...settings, [field]: value });
  };

  const handleNovelTypeChange = (type: NovelType) => {
    if (type === 'short') {
        onSettingsChange({
            ...settings,
            novelType: 'short',
            targetWordCount: 5000, 
            chapterCount: 1 
        });
    } else {
        onSettingsChange({
            ...settings,
            novelType: 'long',
            targetWordCount: 100000,
            chapterCount: 20
        });
    }
  };

  const toggleGenre = (genre: Genre) => {
    const currentGenres = settings.genre;
    if (currentGenres.includes(genre)) {
      handleChange('genre', currentGenres.filter(g => g !== genre));
    } else {
      handleChange('genre', [...currentGenres, genre]);
    }
  };

  const handleAiGeneratePremise = async () => {
    if (!settings.title && !settings.premise) {
        alert("请至少输入标题或一些想法 (Please enter a title or some ideas first)");
        return;
    }

    setIsGeneratingPremise(true);
    try {
        const result = await generatePremise(
            settings.title, 
            settings.premise, 
            settings
        );
        handleChange('premise', result);
    } catch (error) {
        console.error(error);
        alert("无法生成概要，请检查配置。");
    } finally {
        setIsGeneratingPremise(false);
    }
  };

  const handleAiExpandPremise = async () => {
      if (!settings.premise) {
          alert("请先输入一些内容以便 AI 进行扩写 (Please enter some text to expand)");
          return;
      }
      setIsExpandingPremise(true);
      try {
          const result = await expandText(settings.premise, 'Story Premise', settings);
          handleChange('premise', result);
      } catch (error) {
          console.error(error);
          alert("扩写失败 (Expansion failed)");
      } finally {
          setIsExpandingPremise(false);
      }
  };

  const handleAiGenerateWorld = async () => {
    if (!settings.title && settings.genre.length === 0) {
        alert("请先输入标题和选择类型 (Please enter a title and select at least one genre)");
        return;
    }
    
    setIsGeneratingWorld(true);
    try {
        const result = await generateWorldSetting(settings);
        handleChange('worldSetting', result);
    } catch (error) {
        console.error(error);
        alert("无法生成世界设定。");
    } finally {
        setIsGeneratingWorld(false);
    }
  };

  const handleAiExpandWorld = async () => {
    if (!settings.worldSetting) {
        alert("请先输入一些内容以便 AI 进行扩写 (Please enter some text to expand)");
        return;
    }
    setIsExpandingWorld(true);
    try {
        const result = await expandText(settings.worldSetting, 'World Setting', settings);
        handleChange('worldSetting', result);
    } catch (error) {
        console.error(error);
        alert("扩写失败 (Expansion failed)");
    } finally {
        setIsExpandingWorld(false);
    }
  };

  const handleAiGenerateCharacters = async () => {
    if (!settings.title && settings.genre.length === 0) {
        alert("请先输入标题和选择类型 (Please enter a title and select at least one genre)");
        return;
    }
    
    setIsGeneratingCharacters(true);
    try {
        const result = await generateCharacterConcepts(settings);
        handleChange('mainCharacters', result);
    } catch (error) {
        console.error(error);
        alert("无法生成角色设定。");
    } finally {
        setIsGeneratingCharacters(false);
    }
  };

  const handleAiExpandCharacters = async () => {
    if (!settings.mainCharacters) {
        alert("请先输入一些内容以便 AI 进行扩写 (Please enter some text to expand)");
        return;
    }
    setIsExpandingCharacters(true);
    try {
        const result = await expandText(settings.mainCharacters, 'Characters', settings);
        handleChange('mainCharacters', result);
    } catch (error) {
        console.error(error);
        alert("扩写失败 (Expansion failed)");
    } finally {
        setIsExpandingCharacters(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-xl shadow-sm border border-gray-200 mt-10 mb-10">
      <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-gray-100">
        <div className="p-2 bg-indigo-100 rounded-lg">
          <BookOpen className="w-6 h-6 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">开始创作 (Start Your Novel)</h2>
          <p className="text-sm text-gray-500">定义基本设定以生成小说大纲</p>
        </div>
      </div>

      <div className="space-y-6">
        
        {/* Model Configuration Section */}
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
             <div className="flex items-center space-x-2 text-indigo-700 font-medium">
                <Bot size={18} />
                <span>模型配置 (AI Model Settings)</span>
             </div>
             
             <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Provider (服务商)</label>
                <select
                    value={settings.provider}
                    onChange={(e) => handleChange('provider', e.target.value as ModelProvider)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none"
                >
                    <option value="gemini">Google Gemini</option>
                    <option value="alibaba">阿里百炼 (Alibaba Bailian)</option>
                    <option value="volcano">火山引擎 (Volcano Engine)</option>
                    <option value="custom">Custom (OpenAI Compatible)</option>
                </select>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {/* API Key - Hidden for Gemini */}
                 {settings.provider !== 'gemini' && (
                    <div className={settings.provider === 'custom' ? "col-span-1" : "col-span-2 md:col-span-1"}>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">API Key</label>
                        <div className="relative">
                            <input 
                                type="password" 
                                value={settings.apiKey || ''}
                                onChange={(e) => handleChange('apiKey', e.target.value)}
                                placeholder="sk-..."
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none pl-8"
                            />
                            <Key size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                        </div>
                    </div>
                 )}

                 {/* Base URL - Only for Custom */}
                 {settings.provider === 'custom' && (
                    <div className="col-span-1">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Base URL</label>
                        <div className="relative">
                            <input 
                                type="text" 
                                value={settings.baseUrl || ''}
                                onChange={(e) => handleChange('baseUrl', e.target.value)}
                                placeholder="https://api.example.com/v1"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none pl-8"
                            />
                            <Link size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                        </div>
                    </div>
                 )}

                 {/* Model Name */}
                 <div className={settings.provider === 'gemini' ? "col-span-2" : "col-span-2 md:col-span-1"}>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        {settings.provider === 'volcano' ? 'Endpoint ID (接入点 ID)' : 'Model Name (模型名称)'}
                    </label>
                     <div className="relative">
                        <input 
                            type="text" 
                            value={settings.modelName || ''}
                            onChange={(e) => handleChange('modelName', e.target.value)}
                            placeholder={
                                settings.provider === 'gemini' ? 'Default: gemini-3-flash/pro' :
                                settings.provider === 'alibaba' ? 'qwen-plus' :
                                settings.provider === 'volcano' ? 'ep-2024...' :
                                'gpt-4o'
                            }
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none pl-8"
                        />
                        <Server size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                    </div>
                </div>
                
                {/* Max Tokens */}
                 <div className="col-span-2 md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Max Output Tokens (最大输出Token)</label>
                    <div className="relative">
                        <input 
                            type="number" 
                            min="100"
                            step="100"
                            value={settings.maxOutputTokens || ''}
                            onChange={(e) => handleChange('maxOutputTokens', parseInt(e.target.value))}
                            placeholder="Default (Auto)"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none pl-8"
                        />
                        <Gauge size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">Leave empty for model default. Higher values allow longer chapters.</p>
                </div>
             </div>
        </div>

        {/* Novel Format Selection */}
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">作品篇幅 (Format)</label>
            <div className="grid grid-cols-2 gap-4">
                <button
                    onClick={() => handleNovelTypeChange('long')}
                    className={`flex items-center justify-center space-x-2 p-3 rounded-lg border transition-all ${
                        settings.novelType !== 'short'
                        ? 'bg-indigo-50 border-indigo-500 text-indigo-700 ring-1 ring-indigo-500'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300'
                    }`}
                >
                    <BookCopy size={18} />
                    <div className="text-left">
                        <div className="text-sm font-bold">长篇连载 (Series)</div>
                        <div className="text-[10px] opacity-70">无限字数 / Unlimted</div>
                    </div>
                </button>

                <button
                    onClick={() => handleNovelTypeChange('short')}
                    className={`flex items-center justify-center space-x-2 p-3 rounded-lg border transition-all ${
                        settings.novelType === 'short'
                        ? 'bg-indigo-50 border-indigo-500 text-indigo-700 ring-1 ring-indigo-500'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300'
                    }`}
                >
                    <ScrollText size={18} />
                    <div className="text-left">
                        <div className="text-sm font-bold">短篇故事 (One-shot)</div>
                        <div className="text-[10px] opacity-70">Single Chapter</div>
                    </div>
                </button>
            </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">小说标题 (Title)</label>
          <input
            type="text"
            value={settings.title}
            onChange={(e) => handleChange('title', e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors"
            placeholder={settings.genre.includes(Genre.TimeTravel) ? "例如：回到1990当首富" : "例如：沉默的回声"}
          />
        </div>

        <div className="grid grid-cols-1 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">类型 (Genres) - 可多选</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {Object.values(Genre).map((g) => {
                const isSelected = settings.genre.includes(g);
                return (
                  <button
                    key={g}
                    onClick={() => toggleGenre(g)}
                    className={`relative px-3 py-2 rounded-md text-xs font-medium border transition-all duration-200 flex items-center justify-center space-x-1 ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                        : 'bg-white border-gray-300 text-gray-600 hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    <span>{GENRE_LABELS[g].split(' ')[0]}</span>
                    {isSelected && <Check size={12} className="ml-1" />}
                  </button>
                );
              })}
            </div>
            {settings.genre.length === 0 && (
                <p className="text-[10px] text-red-500 mt-1">Please select at least one genre.</p>
            )}
          </div>

          <div>
             <label className="block text-sm font-medium text-gray-700 mb-1">写作语言 (Language)</label>
             <div className="relative">
                <select
                  value={settings.language}
                  onChange={(e) => handleChange('language', e.target.value as Language)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none appearance-none bg-white"
                >
                  <option value="zh">中文 (Chinese)</option>
                  <option value="en">English</option>
                </select>
                <Globe className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
             </div>
          </div>
        </div>

        {/* World/System Setting */}
        <div className={`p-4 rounded-lg border space-y-3 transition-colors ${
            settings.genre.some(g => [Genre.System, Genre.Fantasy, Genre.SciFi].includes(g)) 
            ? 'bg-purple-50 border-purple-200' 
            : 'bg-gray-50 border-gray-200'
        }`}>
            <div className="flex justify-between items-center">
                 <div className="flex items-center space-x-2 text-sm font-medium text-gray-800">
                    {settings.genre.includes(Genre.System) ? <Dna size={18} className="text-purple-600"/> : <Globe2 size={18} className="text-gray-600"/>}
                    <span>{settings.genre.includes(Genre.System) ? "系统规则 (System Rules)" : "世界观设置 (World Setting)"}</span>
                 </div>
                 
                 <div className="flex space-x-2">
                     <button
                        onClick={handleAiGenerateWorld}
                        disabled={isGeneratingWorld || isExpandingWorld || !settings.title || settings.genre.length === 0}
                        className="text-xs flex items-center space-x-1 text-purple-600 hover:text-purple-800 bg-white border border-purple-100 px-3 py-1 rounded-full transition-colors disabled:opacity-50"
                     >
                        {isGeneratingWorld ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                        <span>生成 (Generate)</span>
                     </button>
                     <button
                        onClick={handleAiExpandWorld}
                        disabled={isGeneratingWorld || isExpandingWorld || !settings.worldSetting}
                        className="text-xs flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 bg-white border border-indigo-100 px-3 py-1 rounded-full transition-colors disabled:opacity-50"
                        title="Expand existing text"
                     >
                        {isExpandingWorld ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        <span>AI 扩写 (Expand)</span>
                     </button>
                 </div>
            </div>
            
            <textarea
                value={settings.worldSetting || ''}
                onChange={(e) => handleChange('worldSetting', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors min-h-[100px] text-sm"
                placeholder={settings.genre.includes(Genre.System) 
                    ? "定义系统的功能、任务机制、奖励规则等..." 
                    : "定义世界背景、魔法/科技规则、特殊设定等..."
                }
            />
        </div>

        {/* Character Setting - New */}
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-3">
             <div className="flex justify-between items-center">
                 <div className="flex items-center space-x-2 text-blue-800 font-medium">
                    <Users size={18} />
                    <span>主要角色 (Characters)</span>
                 </div>
                 <div className="flex space-x-2">
                     <button
                        onClick={handleAiGenerateCharacters}
                        disabled={isGeneratingCharacters || isExpandingCharacters || !settings.title || settings.genre.length === 0}
                        className="text-xs flex items-center space-x-1 text-blue-600 hover:text-blue-800 bg-white border border-blue-100 px-3 py-1 rounded-full transition-colors disabled:opacity-50"
                     >
                        {isGeneratingCharacters ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                        <span>生成 (Generate)</span>
                     </button>
                     <button
                        onClick={handleAiExpandCharacters}
                        disabled={isGeneratingCharacters || isExpandingCharacters || !settings.mainCharacters}
                        className="text-xs flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 bg-white border border-indigo-100 px-3 py-1 rounded-full transition-colors disabled:opacity-50"
                        title="Expand existing text"
                     >
                        {isExpandingCharacters ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        <span>AI 扩写 (Expand)</span>
                     </button>
                 </div>
             </div>
             <p className="text-xs text-blue-600/80">
                 Pre-define characters here, or leave empty to auto-generate.
             </p>
             <textarea
                value={settings.mainCharacters || ''}
                onChange={(e) => handleChange('mainCharacters', e.target.value)}
                className="w-full px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors min-h-[80px] text-sm"
                placeholder="例如：李明（主角），性格坚毅；王强（反派），心狠手辣..."
             />
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="block text-sm font-medium text-gray-700">故事梗概 / 核心创意 (Premise)</label>
            <div className="flex space-x-2">
                 <button
                    onClick={handleAiGeneratePremise}
                    disabled={isGeneratingPremise || isExpandingPremise || isLoading}
                    className="text-xs flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isGeneratingPremise ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                    <span>生成 (Generate)</span>
                </button>
                <button
                    onClick={handleAiExpandPremise}
                    disabled={isGeneratingPremise || isExpandingPremise || !settings.premise}
                    className="text-xs flex items-center space-x-1 text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-2 py-1 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isExpandingPremise ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    <span>AI 扩写 (Expand)</span>
                </button>
            </div>
          </div>
          <textarea
            value={settings.premise}
            onChange={(e) => handleChange('premise', e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors min-h-[120px]"
            placeholder="简要描述你的故事内容，或点击上方 AI 按钮自动生成..."
          />
        </div>

        {/* Writing Style Section */}
        <div className="p-4 bg-orange-50 rounded-lg border border-orange-100 space-y-4">
             <div className="flex items-center space-x-2 text-orange-800 font-medium">
                <Feather size={18} />
                <span>写作风格 (Writing Style)</span>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Mic2 size={12}/> Tone (基调)
                  </label>
                  <select
                    value={settings.writingTone}
                    onChange={(e) => handleChange('writingTone', e.target.value as WritingTone)}
                    className="w-full px-3 py-2 text-sm border border-orange-200 rounded-md focus:ring-1 focus:ring-orange-400 outline-none bg-white"
                  >
                    <option value="Neutral">中性 (Neutral)</option>
                    <option value="Dark">暗黑/压抑 (Dark)</option>
                    <option value="Humorous">幽默 (Humorous)</option>
                    <option value="Melancholic">忧伤 (Melancholic)</option>
                    <option value="Fast-paced">快节奏 (Fast-paced)</option>
                    <option value="Romantic">浪漫 (Romantic)</option>
                    <option value="Cynical">愤世嫉俗 (Cynical)</option>
                  </select>
                </div>

                <div>
                   <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Feather size={12}/> Style (文笔)
                   </label>
                   <select
                    value={settings.writingStyle}
                    onChange={(e) => handleChange('writingStyle', e.target.value as WritingStyle)}
                    className="w-full px-3 py-2 text-sm border border-orange-200 rounded-md focus:ring-1 focus:ring-orange-400 outline-none bg-white"
                   >
                     <option value="Simple">通俗易懂 (Simple)</option>
                     <option value="Moderate">标准 (Moderate)</option>
                     <option value="Complex">辞藻华丽 (Complex)</option>
                     <option value="Poetic">诗意 (Poetic)</option>
                   </select>
                </div>

                <div>
                   <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Eye size={12}/> Perspective (视角)
                   </label>
                   <select
                    value={settings.narrativePerspective}
                    onChange={(e) => handleChange('narrativePerspective', e.target.value as NarrativePerspective)}
                    className="w-full px-3 py-2 text-sm border border-orange-200 rounded-md focus:ring-1 focus:ring-orange-400 outline-none bg-white"
                   >
                     <option value="Third Person Limited">第三人称限知 (3rd Person Limited)</option>
                     <option value="Third Person Omniscient">第三人称全知 (3rd Person Omniscient)</option>
                     <option value="First Person">第一人称 (1st Person "I")</option>
                   </select>
                </div>
             </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
           <div>
             <label className="block text-sm font-medium text-gray-700 mb-1">章节数量 (Chapters)</label>
             <input
              type="number"
              min={1}
              max={100}
              value={settings.chapterCount}
              onChange={(e) => handleChange('chapterCount', parseInt(e.target.value))}
              disabled={settings.novelType === 'short'}
              className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none ${settings.novelType === 'short' ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
             />
             <p className="text-[10px] text-gray-500 mt-1">
                {settings.novelType === 'short' ? 'Single Chapter (One-shot)' : 'Suggested: 20+ chapters'}
             </p>
          </div>
          
          <div>
             <label className="block text-sm font-medium text-gray-700 mb-1">目标总字数 (Target Words)</label>
             <div className="relative">
               <input
                type="number"
                step={1000}
                value={settings.targetWordCount}
                onChange={(e) => handleChange('targetWordCount', parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
               />
               <span className="absolute right-4 top-2 text-gray-400 text-sm">字</span>
             </div>
             <p className="text-[10px] text-gray-500 mt-1">
                {settings.novelType === 'short' ? 'Range: 3,000 - 10,000 words' : 'Unlimited'}
             </p>
          </div>
        </div>

        <div className="pt-4">
            {isLoading && onStop ? (
                <button
                    onClick={onStop}
                    className="w-full flex items-center justify-center space-x-2 py-3 rounded-lg text-white font-medium transition-all bg-red-500 hover:bg-red-600 shadow-md hover:shadow-lg animate-pulse"
                >
                    <Square className="w-5 h-5 fill-current" />
                    <span>停止生成 (Stop)</span>
                </button>
            ) : (
                <button
                    onClick={onSubmit}
                    disabled={isLoading || !settings.title || !settings.premise || settings.genre.length === 0}
                    className={`w-full flex items-center justify-center space-x-2 py-3 rounded-lg text-white font-medium transition-all ${
                    isLoading || !settings.title || !settings.premise || settings.genre.length === 0
                        ? 'bg-indigo-300 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700 shadow-md hover:shadow-lg'
                    }`}
                >
                    {isLoading ? (
                    <span className="flex items-center">
                        <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" />
                        正在生成大纲...
                    </span>
                    ) : (
                    <>
                        <PenTool className="w-5 h-5" />
                        <span>生成大纲</span>
                    </>
                    )}
                </button>
            )}
        </div>
      </div>
    </div>
  );
};

export default SettingsForm;