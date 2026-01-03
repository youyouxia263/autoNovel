
import React, { useState } from 'react';
import { NovelSettings, Language, WritingTone, WritingStyle, NarrativePerspective, NovelType } from '../types';
import { BookOpen, PenTool, Sparkles, Globe, Wand2, Loader2, Feather, Eye, Mic2, ScrollText, BookCopy, Globe2, Dna, Check, Square, Users, Tag, Layers } from 'lucide-react';
import { generatePremise, generateWorldSetting, expandText, generateCharacterConcepts } from '../services/geminiService';

interface SettingsFormProps {
  settings: NovelSettings;
  onSettingsChange: (settings: NovelSettings) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isLoading: boolean;
}

// --- Tomato Novel Classification Data ---

const MAIN_CATEGORIES = {
    male: [
        "玄幻", "奇幻", "武侠", "仙侠", "都市", "都市修真", "都市异能", 
        "历史", "军事", "游戏", "体育", "科幻", "悬疑", "灵异", "现实", "轻小说"
    ],
    female: [
        "现代言情", "古代言情", "幻想言情", "仙侠奇缘", "青春校园", "职场", 
        "豪门总裁", "婚恋", "宫斗宅斗", "种田", "快穿", "无限流", "悬疑推理", "现实情感"
    ]
};

const THEMES = [
    "重生", "穿越", "穿书", "快穿", "无限流", "系统", "签到", "末世", "国运", "规则怪谈", 
    "直播", "娱乐圈", "商战", "校园", "职场", "西幻", "东方玄幻", "架空历史", "平行世界", "未来世界", "克苏鲁"
];

const ROLES = [
    "男主视角", "女主视角", "群像", "单女主", "多女主", "双男主", "女强", "男强", "强强", 
    "事业型主角", "团宠", "马甲", "萌宝", "师徒", "青梅竹马", "豪门世家", "黑莲花", "白月光", "反派主角"
];

const PLOTS = [
    "爽文", "甜宠", "热血", "轻松", "搞笑", "高燃", "高能", "慢热", "快节奏", 
    "治愈", "致郁", "刀中带糖", "追妻火葬场", "先婚后爱", "破镜重圆", "扮猪吃虎", "无敌流", "升级流", "日常流"
];

const SettingsForm: React.FC<SettingsFormProps> = ({ settings, onSettingsChange, onSubmit, onStop, isLoading }) => {
  const [isGeneratingPremise, setIsGeneratingPremise] = useState(false);
  const [isExpandingPremise, setIsExpandingPremise] = useState(false);
  
  const [isGeneratingWorld, setIsGeneratingWorld] = useState(false);
  const [isExpandingWorld, setIsExpandingWorld] = useState(false);

  const [isGeneratingCharacters, setIsGeneratingCharacters] = useState(false);
  const [isExpandingCharacters, setIsExpandingCharacters] = useState(false);
  
  // UI State for Tabs
  const [categoryTab, setCategoryTab] = useState<'male' | 'female'>('male');

  const handleChange = (field: keyof NovelSettings, value: any) => {
    onSettingsChange({ ...settings, [field]: value });
  };

  const handleNovelTypeChange = (type: NovelType) => {
    if (type === 'short') {
        onSettingsChange({
            ...settings,
            novelType: 'short',
            targetWordCount: 60000, 
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

  // --- Tag Logic ---

  const handleMainCategorySelect = (cat: string) => {
      handleChange('mainCategory', cat);
  };

  const toggleSelection = (field: 'themes' | 'roles' | 'plots', item: string, max: number) => {
      const currentList = settings[field] || [];
      if (currentList.includes(item)) {
          handleChange(field, currentList.filter(i => i !== item));
      } else {
          if (currentList.length >= max) {
            // Optional: Alert user or replace oldest
            return; 
          }
          handleChange(field, [...currentList, item]);
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
    if (!settings.title && !settings.mainCategory) {
        alert("请先输入标题和选择类型 (Please enter a title and select main category)");
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
    if (!settings.title && !settings.mainCategory) {
        alert("请先输入标题和选择类型 (Please enter a title and select main category)");
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

  const isConfigValid = settings.title && settings.mainCategory && settings.premise;

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-xl shadow-sm border border-gray-200 mt-6 mb-10">
      <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-gray-100">
        <div className="p-2 bg-indigo-100 rounded-lg">
          <BookOpen className="w-6 h-6 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">开始创作 (Start Your Novel)</h2>
          <p className="text-sm text-gray-500">根据番茄小说分类体系定义作品 (Define novel based on Tomato Novel standard)</p>
        </div>
      </div>

      <div className="space-y-8">
        
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">小说标题 (Title)</label>
                <input
                    type="text"
                    value={settings.title}
                    onChange={(e) => handleChange('title', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors"
                    placeholder="例如：全球高武、我在精神病院学斩神"
                />
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

        {/* --- Classification Section --- */}
        <div className="border rounded-xl p-5 bg-gray-50 space-y-6">
            <div className="flex items-center gap-2 mb-2">
                <Tag size={18} className="text-indigo-600"/>
                <h3 className="font-bold text-gray-800">作品分类 (Classification)</h3>
            </div>
            
            {/* 1. Main Category */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-bold text-gray-700">一、主分类 (必选 1 项)</label>
                    <div className="flex bg-white rounded-lg p-0.5 border">
                        <button 
                            onClick={() => setCategoryTab('male')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${categoryTab === 'male' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            男频 (Male)
                        </button>
                        <button 
                            onClick={() => setCategoryTab('female')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${categoryTab === 'female' ? 'bg-pink-100 text-pink-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            女频 (Female)
                        </button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {MAIN_CATEGORIES[categoryTab].map(cat => (
                        <button
                            key={cat}
                            onClick={() => handleMainCategorySelect(cat)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                settings.mainCategory === cat
                                ? (categoryTab === 'male' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-pink-600 border-pink-600 text-white')
                                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            {/* 2. Themes */}
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                    二、主题 (可选 1-3 项) 
                    <span className={`ml-2 text-xs font-normal ${settings.themes.length > 3 ? 'text-red-500' : 'text-gray-400'}`}>
                        已选: {settings.themes.length}/3
                    </span>
                </label>
                <div className="flex flex-wrap gap-2">
                    {THEMES.map(theme => (
                        <button
                            key={theme}
                            onClick={() => toggleSelection('themes', theme, 3)}
                            className={`px-3 py-1 rounded-full text-xs border transition-all ${
                                settings.themes.includes(theme)
                                ? 'bg-purple-100 border-purple-300 text-purple-700'
                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {theme}
                        </button>
                    ))}
                </div>
            </div>

            {/* 3. Roles */}
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                    三、角色 (可选 1-2 项)
                    <span className={`ml-2 text-xs font-normal ${settings.roles.length > 2 ? 'text-red-500' : 'text-gray-400'}`}>
                        已选: {settings.roles.length}/2
                    </span>
                </label>
                <div className="flex flex-wrap gap-2">
                    {ROLES.map(role => (
                        <button
                            key={role}
                            onClick={() => toggleSelection('roles', role, 2)}
                            className={`px-3 py-1 rounded-full text-xs border transition-all ${
                                settings.roles.includes(role)
                                ? 'bg-blue-100 border-blue-300 text-blue-700'
                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {role}
                        </button>
                    ))}
                </div>
            </div>

            {/* 4. Plots */}
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                    四、情节 (可选 1-3 项)
                    <span className={`ml-2 text-xs font-normal ${settings.plots.length > 3 ? 'text-red-500' : 'text-gray-400'}`}>
                        已选: {settings.plots.length}/3
                    </span>
                </label>
                <div className="flex flex-wrap gap-2">
                    {PLOTS.map(plot => (
                        <button
                            key={plot}
                            onClick={() => toggleSelection('plots', plot, 3)}
                            className={`px-3 py-1 rounded-full text-xs border transition-all ${
                                settings.plots.includes(plot)
                                ? 'bg-orange-100 border-orange-300 text-orange-700'
                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {plot}
                        </button>
                    ))}
                </div>
            </div>
        </div>

        {/* World/System Setting */}
        <div className={`p-4 rounded-lg border space-y-3 transition-colors ${
            settings.themes.includes("系统") || settings.mainCategory?.includes("科幻") || settings.mainCategory?.includes("玄幻")
            ? 'bg-purple-50 border-purple-200' 
            : 'bg-gray-50 border-gray-200'
        }`}>
            <div className="flex justify-between items-center">
                 <div className="flex items-center space-x-2 text-sm font-medium text-gray-800">
                    {settings.themes.includes("系统") ? <Dna size={18} className="text-purple-600"/> : <Globe2 size={18} className="text-gray-600"/>}
                    <span>{settings.themes.includes("系统") ? "系统规则 (System Rules)" : "世界观设定 (World Setting)"}</span>
                 </div>
                 
                 <div className="flex space-x-2">
                     <button
                        onClick={handleAiGenerateWorld}
                        disabled={isGeneratingWorld || isExpandingWorld || !settings.title || !settings.mainCategory}
                        className="text-xs flex items-center space-x-1 text-purple-600 hover:text-purple-800 bg-white border border-purple-100 px-3 py-1 rounded-full transition-colors disabled:opacity-50"
                     >
                        {isGeneratingWorld ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                        <span>生成 (Generate)</span>
                     </button>
                     <button
                        onClick={handleAiExpandWorld}
                        disabled={isGeneratingWorld || isExpandingWorld || !settings.worldSetting}
                        className="text-xs flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 bg-white border border-indigo-100 px-3 py-1 rounded-full transition-colors disabled:opacity-50"
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
                placeholder={settings.themes.includes("系统") 
                    ? "定义系统的功能、任务机制、奖励规则等..." 
                    : "定义世界背景、修炼体系/魔法/科技规则、特殊设定等..."
                }
            />
        </div>

        {/* Character Setting */}
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-3">
             <div className="flex justify-between items-center">
                 <div className="flex items-center space-x-2 text-blue-800 font-medium">
                    <Users size={18} />
                    <span>主要角色 (Characters)</span>
                 </div>
                 <div className="flex space-x-2">
                     <button
                        onClick={handleAiGenerateCharacters}
                        disabled={isGeneratingCharacters || isExpandingCharacters || !settings.title || !settings.mainCategory}
                        className="text-xs flex items-center space-x-1 text-blue-600 hover:text-blue-800 bg-white border border-blue-100 px-3 py-1 rounded-full transition-colors disabled:opacity-50"
                     >
                        {isGeneratingCharacters ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                        <span>生成 (Generate)</span>
                     </button>
                     <button
                        onClick={handleAiExpandCharacters}
                        disabled={isGeneratingCharacters || isExpandingCharacters || !settings.mainCharacters}
                        className="text-xs flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 bg-white border border-indigo-100 px-3 py-1 rounded-full transition-colors disabled:opacity-50"
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
                        <div className="text-sm font-bold">长篇连载</div>
                        <div className="text-[10px] opacity-70">无限字数</div>
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
                        <div className="text-sm font-bold">短篇故事</div>
                        <div className="text-[10px] opacity-70">单章/短篇</div>
                    </div>
                </button>
            </div>
          </div>
          
           <div>
             <label className="block text-sm font-medium text-gray-700 mb-1">章节数量 (Chapters)</label>
             <input
              type="number"
              min={1}
              max={3000}
              value={settings.chapterCount}
              onChange={(e) => handleChange('chapterCount', parseInt(e.target.value))}
              disabled={settings.novelType === 'short'}
              className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none ${settings.novelType === 'short' ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
             />
             <p className="text-[10px] text-gray-500 mt-1 flex items-center gap-1">
                {settings.chapterCount > 100 && <Layers size={10} className="text-indigo-500" />}
                {settings.novelType === 'short' 
                    ? '单章节' 
                    : settings.chapterCount > 100 
                        ? '将自动启用分卷管理 (Volume Structure Enabled)' 
                        : '建议 20 章+'}
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
                    disabled={isLoading || !isConfigValid}
                    className={`w-full flex items-center justify-center space-x-2 py-3 rounded-lg text-white font-medium transition-all ${
                    isLoading || !isConfigValid
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
