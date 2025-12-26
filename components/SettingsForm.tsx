import React, { useState } from 'react';
import { NovelSettings, Genre, Language, ModelProvider, WritingTone, WritingStyle, NarrativePerspective } from '../types';
import { BookOpen, PenTool, Sparkles, Globe, Wand2, Loader2, Bot, Key, Server, Feather, Eye, Mic2, Link } from 'lucide-react';
import { generatePremise } from '../services/geminiService';

interface SettingsFormProps {
  settings: NovelSettings;
  onSettingsChange: (settings: NovelSettings) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

const GENRE_LABELS: Record<Genre, string> = {
  [Genre.Suspense]: '悬疑 (Suspense)',
  [Genre.Romance]: '言情 (Romance)',
  [Genre.Thriller]: '惊悚 (Thriller)',
  [Genre.Mystery]: '推理 (Mystery)',
  [Genre.Fantasy]: '玄幻 (Fantasy)',
  [Genre.SciFi]: '科幻 (Sci-Fi)',
};

const SettingsForm: React.FC<SettingsFormProps> = ({ settings, onSettingsChange, onSubmit, isLoading }) => {
  const [isGeneratingPremise, setIsGeneratingPremise] = useState(false);
  
  const handleChange = (field: keyof NovelSettings, value: any) => {
    onSettingsChange({ ...settings, [field]: value });
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

                 {/* Model Name - Visible for all, but with different placeholders */}
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
                    {settings.provider === 'volcano' && <p className="text-[10px] text-gray-400 mt-1">Volcano Console: "Endpoint ID"</p>}
                    {settings.provider === 'gemini' && <p className="text-[10px] text-gray-400 mt-1">Leave empty to use recommended models (Flash for outline, Pro for writing).</p>}
                </div>
             </div>
        </div>


        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">小说标题 (Title)</label>
          <input
            type="text"
            value={settings.title}
            onChange={(e) => handleChange('title', e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors"
            placeholder="例如：沉默的回声"
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="block text-sm font-medium text-gray-700">故事梗概 / 核心创意 (Premise)</label>
            <button
                onClick={handleAiGeneratePremise}
                disabled={isGeneratingPremise || isLoading}
                className="text-xs flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={settings.premise ? "Expand existing idea" : "Generate from title"}
            >
                {isGeneratingPremise ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                <span>{settings.premise ? "AI 润色/扩充 (AI Refine)" : "AI 自动生成 (Auto Generate)"}</span>
            </button>
          </div>
          <textarea
            value={settings.premise}
            onChange={(e) => handleChange('premise', e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors min-h-[120px]"
            placeholder="简要描述你的故事内容，或点击上方 AI 按钮自动生成..."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">类型 (Genre)</label>
            <div className="relative">
              <select
                value={settings.genre}
                onChange={(e) => handleChange('genre', e.target.value as Genre)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none appearance-none bg-white"
              >
                {Object.values(Genre).map((g) => (
                  <option key={g} value={g}>{GENRE_LABELS[g]}</option>
                ))}
              </select>
              <Sparkles className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
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
              min={3}
              max={50}
              value={settings.chapterCount}
              onChange={(e) => handleChange('chapterCount', parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
             />
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
          </div>
        </div>

        <div className="pt-4">
          <button
            onClick={onSubmit}
            disabled={isLoading || !settings.title || !settings.premise}
            className={`w-full flex items-center justify-center space-x-2 py-3 rounded-lg text-white font-medium transition-all ${
              isLoading || !settings.title || !settings.premise
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
        </div>
      </div>
    </div>
  );
};

export default SettingsForm;