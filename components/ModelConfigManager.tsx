
import React, { useState, useEffect } from 'react';
import { ModelConfig, NovelSettings, ModelProvider } from '../types';
import { DAOFactory } from '../services/dao';
import { Plus, Edit2, Trash2, Save, X, Bot, Server, Key, Link, Gauge, Play, CheckCircle2, Cpu } from 'lucide-react';

interface ModelConfigManagerProps {
    settings: NovelSettings;
    onSettingsChange: (settings: NovelSettings) => void;
}

const emptyConfig: ModelConfig = {
    id: '',
    name: '',
    provider: 'gemini',
    apiKey: '',
    modelName: '',
    baseUrl: '',
    maxOutputTokens: undefined,
    createdAt: new Date()
};

const ModelConfigManager: React.FC<ModelConfigManagerProps> = ({ settings, onSettingsChange }) => {
    const [configs, setConfigs] = useState<ModelConfig[]>([]);
    const [viewMode, setViewMode] = useState<'list' | 'edit'>('list');
    const [editingConfig, setEditingConfig] = useState<ModelConfig>(emptyConfig);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        loadConfigs();
    }, []);

    const loadConfigs = async () => {
        setIsLoading(true);
        try {
            const dao = DAOFactory.getDAO(settings);
            const list = await dao.listModelConfigs();
            setConfigs(list);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreate = () => {
        setEditingConfig({ ...emptyConfig, name: 'New Configuration' });
        setViewMode('edit');
    };

    const handleEdit = (config: ModelConfig) => {
        setEditingConfig(config);
        setViewMode('edit');
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm("确定要删除此配置吗？(Delete this config?)")) return;
        const dao = DAOFactory.getDAO(settings);
        await dao.deleteModelConfig(id);
        await loadConfigs();
    };

    const handleSave = async () => {
        if (!editingConfig.name) {
            alert("请输入配置名称 (Please enter a name)");
            return;
        }
        const dao = DAOFactory.getDAO(settings);
        await dao.saveModelConfig(editingConfig);
        await loadConfigs();
        setViewMode('list');
    };

    const handleActivate = (config: ModelConfig) => {
        onSettingsChange({
            ...settings,
            provider: config.provider,
            apiKey: config.apiKey,
            modelName: config.modelName,
            baseUrl: config.baseUrl,
            maxOutputTokens: config.maxOutputTokens
        });
        alert(`已启用配置: ${config.name}`);
    };

    // Check if a config is currently active (heuristic matching)
    const isActive = (config: ModelConfig) => {
        return settings.provider === config.provider && 
               settings.apiKey === config.apiKey && 
               settings.modelName === config.modelName;
    };

    const handleEditChange = (field: keyof ModelConfig, value: any) => {
        setEditingConfig(prev => ({ ...prev, [field]: value }));
    };

    if (viewMode === 'edit') {
        return (
            <div className="flex-1 overflow-y-auto bg-gray-50 p-8">
                <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-100">
                        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                            <Cpu className="text-indigo-600" />
                            {editingConfig.id ? '编辑模型配置 (Edit Config)' : '新建模型配置 (New Config)'}
                        </h2>
                        <button onClick={() => setViewMode('list')} className="text-gray-500 hover:text-gray-800">
                            <X size={24} />
                        </button>
                    </div>

                    <div className="space-y-5">
                         <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">配置名称 (Name)</label>
                            <input 
                                type="text" 
                                value={editingConfig.name}
                                onChange={(e) => handleEditChange('name', e.target.value)}
                                placeholder="例如: 我的付费 Gemini Key"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                         </div>

                         <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">供应商 (Provider)</label>
                            <div className="relative">
                                <select
                                    value={editingConfig.provider}
                                    onChange={(e) => handleEditChange('provider', e.target.value as ModelProvider)}
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none appearance-none bg-white"
                                >
                                    <option value="gemini">Google Gemini</option>
                                    <option value="alibaba">Alibaba Bailian (Qwen)</option>
                                    <option value="volcano">Volcano Engine (Doubao)</option>
                                    <option value="custom">Custom (OpenAI Compatible)</option>
                                </select>
                                <Bot size={18} className="absolute left-3 top-2.5 text-gray-500 pointer-events-none" />
                            </div>
                         </div>

                         {editingConfig.provider !== 'gemini' && (
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">API Key</label>
                                <div className="relative">
                                    <input 
                                        type="password" 
                                        value={editingConfig.apiKey || ''}
                                        onChange={(e) => handleEditChange('apiKey', e.target.value)}
                                        placeholder="sk-..."
                                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                    <Key size={18} className="absolute left-3 top-2.5 text-gray-500 pointer-events-none" />
                                </div>
                            </div>
                         )}

                         {editingConfig.provider === 'custom' && (
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Base URL</label>
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        value={editingConfig.baseUrl || ''}
                                        onChange={(e) => handleEditChange('baseUrl', e.target.value)}
                                        placeholder="https://api.openai.com/v1/chat/completions"
                                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                    <Link size={18} className="absolute left-3 top-2.5 text-gray-500 pointer-events-none" />
                                </div>
                            </div>
                         )}

                         <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">
                                {editingConfig.provider === 'volcano' ? 'Endpoint ID' : 'Model Name'}
                            </label>
                            <div className="relative">
                                <input 
                                    type="text" 
                                    value={editingConfig.modelName || ''}
                                    onChange={(e) => handleEditChange('modelName', e.target.value)}
                                    placeholder={editingConfig.provider === 'gemini' ? 'gemini-3-flash-preview' : 'model-name'}
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                                <Server size={18} className="absolute left-3 top-2.5 text-gray-500 pointer-events-none" />
                            </div>
                         </div>

                         <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Max Output Tokens (Optional)</label>
                            <div className="relative">
                                <input 
                                    type="number" 
                                    min="100"
                                    step="100"
                                    value={editingConfig.maxOutputTokens || ''}
                                    onChange={(e) => handleEditChange('maxOutputTokens', e.target.value ? parseInt(e.target.value) : undefined)}
                                    placeholder="Default"
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                                <Gauge size={18} className="absolute left-3 top-2.5 text-gray-500 pointer-events-none" />
                            </div>
                         </div>

                         <div className="flex pt-6 space-x-3">
                             <button onClick={() => setViewMode('list')} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors font-medium">取消 (Cancel)</button>
                             <button onClick={handleSave} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2">
                                 <Save size={18} />
                                 <span>保存配置 (Save Config)</span>
                             </button>
                         </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto bg-gray-50 p-8">
            <div className="max-w-5xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Cpu className="text-indigo-600" />
                            模型配置管理 (Model Configurations)
                        </h2>
                        <p className="text-gray-500 text-sm mt-1">Manage your AI providers and model parameters</p>
                    </div>
                    <button 
                        onClick={handleCreate}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-sm hover:shadow-md"
                    >
                        <Plus size={18} />
                        <span>新建配置 (Add New)</span>
                    </button>
                </div>

                {configs.length === 0 && !isLoading ? (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                        <Bot size={48} className="mx-auto text-gray-300 mb-4" />
                        <h3 className="text-gray-500 font-medium">暂无保存的配置</h3>
                        <p className="text-gray-400 text-sm mb-6">Create a configuration to switch between different AI models easily.</p>
                        <button onClick={handleCreate} className="text-indigo-600 hover:text-indigo-800 font-medium text-sm">Create Now &rarr;</button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {configs.map(config => {
                            const active = isActive(config);
                            return (
                                <div key={config.id} className={`bg-white rounded-xl border transition-all duration-200 hover:shadow-md flex flex-col ${active ? 'border-indigo-500 ring-1 ring-indigo-500 shadow-sm' : 'border-gray-200'}`}>
                                    <div className="p-5 flex-1">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex items-center gap-2">
                                                <div className={`p-2 rounded-lg ${config.provider === 'gemini' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                                                    <Bot size={20} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-gray-800 text-sm">{config.name}</h3>
                                                    <p className="text-xs text-gray-500 uppercase">{config.provider}</p>
                                                </div>
                                            </div>
                                            {active && (
                                                <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1">
                                                    <CheckCircle2 size={10} /> Active
                                                </span>
                                            )}
                                        </div>
                                        
                                        <div className="space-y-2 text-xs text-gray-600 mt-4">
                                            <div className="flex items-center gap-2" title="Model Name">
                                                <Server size={14} className="text-gray-400" />
                                                <span className="truncate font-mono bg-gray-50 px-1.5 py-0.5 rounded">{config.modelName}</span>
                                            </div>
                                            {config.baseUrl && (
                                                 <div className="flex items-center gap-2" title="Base URL">
                                                    <Link size={14} className="text-gray-400" />
                                                    <span className="truncate max-w-[200px]">{config.baseUrl}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="border-t border-gray-100 p-3 bg-gray-50/50 rounded-b-xl flex justify-between items-center">
                                        <div className="flex gap-1">
                                            <button onClick={() => handleEdit(config)} className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-white rounded transition-colors" title="Edit">
                                                <Edit2 size={16} />
                                            </button>
                                            <button onClick={() => handleDelete(config.id)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-white rounded transition-colors" title="Delete">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                        <button 
                                            onClick={() => handleActivate(config)}
                                            disabled={active}
                                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                                active 
                                                ? 'bg-gray-200 text-gray-400 cursor-default'
                                                : 'bg-white border border-gray-200 text-gray-700 hover:border-indigo-300 hover:text-indigo-600 shadow-sm'
                                            }`}
                                        >
                                            <Play size={14} className={active ? '' : 'fill-current'} />
                                            <span>{active ? '已启用 (Active)' : '启用 (Activate)'}</span>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ModelConfigManager;
