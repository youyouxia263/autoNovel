
import React, { useState } from 'react';
import { NovelSettings } from '../types';
import { PROMPT_KEYS, DEFAULT_PROMPTS } from '../services/promptTemplates';
import { Save, RotateCcw, FileText, Sparkles, Layout, Users, Globe2, Edit3, CheckCircle2 } from 'lucide-react';
import { DAOFactory } from '../services/dao';

interface PromptConfigManagerProps {
    settings: NovelSettings;
    onSettingsChange: (settings: NovelSettings) => void;
}

const PREVIEW_LABELS: Record<string, { label: string, icon: any }> = {
    [PROMPT_KEYS.GENERATE_OUTLINE]: { label: '生成大纲 (Outline)', icon: Layout },
    [PROMPT_KEYS.GENERATE_CHAPTER]: { label: '生成章节 (Chapter)', icon: FileText },
    [PROMPT_KEYS.GENERATE_CHARACTERS]: { label: '批量生成角色 (Batch Characters)', icon: Users },
    [PROMPT_KEYS.GENERATE_SINGLE_CHARACTER]: { label: '单个角色生成 (Single Character)', icon: Users },
    [PROMPT_KEYS.GENERATE_WORLD]: { label: '世界观生成 (World Setting)', icon: Globe2 },
    [PROMPT_KEYS.GENERATE_PREMISE]: { label: '概要生成 (Premise)', icon: Sparkles },
    [PROMPT_KEYS.EXPAND_TEXT]: { label: 'AI 扩写 (Expand Text)', icon: Edit3 },
    [PROMPT_KEYS.CHECK_CONSISTENCY]: { label: '一致性检查 (Check Consistency)', icon: CheckCircle2 },
    [PROMPT_KEYS.FIX_CONSISTENCY]: { label: '一致性修复 (Fix Consistency)', icon: Sparkles },
};

const PromptConfigManager: React.FC<PromptConfigManagerProps> = ({ settings, onSettingsChange }) => {
    const [selectedKey, setSelectedKey] = useState<string>(PROMPT_KEYS.GENERATE_OUTLINE);
    const [editValue, setEditValue] = useState<string>(
        settings.customPrompts?.[PROMPT_KEYS.GENERATE_OUTLINE] || DEFAULT_PROMPTS[PROMPT_KEYS.GENERATE_OUTLINE]
    );
    const [isDirty, setIsDirty] = useState(false);

    const handleSelect = (key: string) => {
        if (isDirty) {
            if (!window.confirm("Changes not saved. Discard?")) return;
        }
        setSelectedKey(key);
        setEditValue(settings.customPrompts?.[key] || DEFAULT_PROMPTS[key]);
        setIsDirty(false);
    };

    const handleChange = (val: string) => {
        setEditValue(val);
        setIsDirty(true);
    };

    const handleSave = async () => {
        const newCustomPrompts = {
            ...(settings.customPrompts || {}),
            [selectedKey]: editValue
        };
        
        // If value matches default exactly, maybe remove it? 
        // But user might want to explicitly save it. Let's save it.
        
        const newSettings = { ...settings, customPrompts: newCustomPrompts };
        onSettingsChange(newSettings);
        
        // Persist
        const dao = DAOFactory.getDAO(newSettings);
        await dao.saveNovel({ settings: newSettings } as any); // Partial save just for prompts

        setIsDirty(false);
        alert("Prompt configuration saved.");
    };

    const handleReset = () => {
        if (!window.confirm("Reset to default system prompt?")) return;
        
        const newCustomPrompts = { ...settings.customPrompts };
        delete newCustomPrompts[selectedKey];
        
        const newSettings = { ...settings, customPrompts: newCustomPrompts };
        onSettingsChange(newSettings);

        setEditValue(DEFAULT_PROMPTS[selectedKey]);
        setIsDirty(false);

        // Persist
        const dao = DAOFactory.getDAO(newSettings);
        dao.saveNovel({ settings: newSettings } as any); 
    };

    return (
        <div className="flex-1 overflow-hidden flex flex-col bg-gray-50">
            <header className="bg-white border-b border-gray-200 py-4 px-6">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <Edit3 className="text-indigo-600" />
                    提示词配置 (Prompt Configuration)
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                    Customize the internal prompts used by the AI. Use <code>{`{{variable}}`}</code> placeholders.
                </p>
            </header>
            
            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar List */}
                <div className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
                    {Object.entries(PREVIEW_LABELS).map(([key, info]) => {
                        const Icon = info.icon;
                        const isModified = !!settings.customPrompts?.[key];
                        return (
                            <button
                                key={key}
                                onClick={() => handleSelect(key)}
                                className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors flex items-center gap-3 ${
                                    selectedKey === key 
                                    ? 'bg-indigo-50 border-r-2 border-r-indigo-500 text-indigo-700' 
                                    : 'text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                <Icon size={16} />
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-semibold truncate">{info.label}</div>
                                    <div className="text-[10px] text-gray-400 truncate">{key}</div>
                                </div>
                                {isModified && <div className="w-1.5 h-1.5 rounded-full bg-orange-400" title="Modified" />}
                            </button>
                        );
                    })}
                </div>

                {/* Editor Area */}
                <div className="flex-1 flex flex-col p-6 overflow-hidden">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-700">{PREVIEW_LABELS[selectedKey].label}</span>
                            {settings.customPrompts?.[selectedKey] && (
                                <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full border border-orange-200">
                                    Modified
                                </span>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={handleReset}
                                disabled={!settings.customPrompts?.[selectedKey]}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                            >
                                <RotateCcw size={14} />
                                <span>Reset to Default</span>
                            </button>
                            <button 
                                onClick={handleSave}
                                disabled={!isDirty}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 disabled:bg-gray-400"
                            >
                                <Save size={14} />
                                <span>Save Changes</span>
                            </button>
                        </div>
                    </div>
                    
                    <textarea 
                        value={editValue}
                        onChange={(e) => handleChange(e.target.value)}
                        className="flex-1 w-full p-4 border border-gray-300 rounded-lg font-mono text-sm leading-relaxed resize-none focus:ring-2 focus:ring-indigo-500 outline-none"
                        spellCheck={false}
                    />
                    
                    <div className="mt-4 p-3 bg-blue-50 text-blue-800 text-xs rounded-lg border border-blue-100">
                        <strong>Available Placeholders:</strong> {`{{title}}`}, {`{{genre}}`}, {`{{language}}`}, {`{{premise}}`}... (Dependent on prompt type)
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PromptConfigManager;
