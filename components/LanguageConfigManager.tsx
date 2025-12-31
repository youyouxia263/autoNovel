
import React, { useState } from 'react';
import { NovelSettings, Language } from '../types';
import { Globe, Languages, Check, MessageSquare } from 'lucide-react';

interface LanguageConfigManagerProps {
    settings: NovelSettings;
    onSettingsChange: (settings: NovelSettings) => void;
}

const LanguageConfigManager: React.FC<LanguageConfigManagerProps> = ({ settings, onSettingsChange }) => {
    
    const handleLanguageChange = (lang: Language) => {
        onSettingsChange({
            ...settings,
            language: lang
        });
    };

    return (
        <div className="flex-1 overflow-y-auto bg-gray-50 p-8">
            <div className="max-w-3xl mx-auto">
                <header className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <Globe className="text-indigo-600" />
                        中英文配置 (Language Settings)
                    </h2>
                    <p className="text-gray-500 text-sm mt-1">
                        Configure output language and interface preferences.
                    </p>
                </header>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-8">
                    
                    {/* Output Language */}
                    <section>
                         <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                            <MessageSquare size={20} className="text-gray-400"/>
                            生成语言 (Output Language)
                         </h3>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <button
                                onClick={() => handleLanguageChange('zh')}
                                className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                                    settings.language === 'zh'
                                    ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500'
                                    : 'bg-white border-gray-200 hover:border-indigo-200'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-lg font-serif font-bold text-red-600">
                                        中
                                    </div>
                                    <div className="text-left">
                                        <div className="font-bold text-gray-800">中文 (Chinese)</div>
                                        <div className="text-xs text-gray-500">Generate content in Simplified Chinese</div>
                                    </div>
                                </div>
                                {settings.language === 'zh' && <Check className="text-indigo-600" />}
                            </button>

                            <button
                                onClick={() => handleLanguageChange('en')}
                                className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                                    settings.language === 'en'
                                    ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500'
                                    : 'bg-white border-gray-200 hover:border-indigo-200'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-lg font-serif font-bold text-blue-600">
                                        En
                                    </div>
                                    <div className="text-left">
                                        <div className="font-bold text-gray-800">English</div>
                                        <div className="text-xs text-gray-500">Generate content in English</div>
                                    </div>
                                </div>
                                {settings.language === 'en' && <Check className="text-indigo-600" />}
                            </button>
                         </div>
                    </section>

                    <hr className="border-gray-100" />

                    {/* Interface Language (Placeholder) */}
                    <section className="opacity-60 cursor-not-allowed relative">
                        {/* Overlay to indicate disabled/future feature */}
                        <div className="absolute inset-0 z-10"></div>
                        
                         <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                            <Languages size={20} className="text-gray-400"/>
                            界面语言 (Interface Language)
                         </h3>
                         <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                             <p className="text-sm text-gray-500 mb-2">
                                Current Interface: <span className="font-semibold text-gray-700">English / Chinese (Hybrid)</span>
                             </p>
                             <div className="flex gap-3">
                                 <button className="px-3 py-1 bg-white border border-gray-300 rounded text-sm text-gray-400">English</button>
                                 <button className="px-3 py-1 bg-white border border-gray-300 rounded text-sm text-gray-400">中文</button>
                             </div>
                             <p className="text-xs text-orange-500 mt-2">
                                * Interface language switching is currently under development.
                             </p>
                         </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default LanguageConfigManager;
