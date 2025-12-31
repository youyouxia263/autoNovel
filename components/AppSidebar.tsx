
import React, { useState } from 'react';
import { Plus, Book, Trash2, FileText, Layout, Settings, Cpu, MessageSquareQuote, ChevronDown, ChevronRight } from 'lucide-react';
import { NovelSettings } from '../types';

interface SavedNovel {
  id: string;
  title: string;
  updatedAt: Date;
}

interface AppSidebarProps {
  novels: SavedNovel[];
  currentNovelId?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  settings: NovelSettings;
  onSettingsChange: (settings: NovelSettings) => void;
  currentView: 'workspace' | 'models' | 'prompts';
  onNavigate: (view: 'workspace' | 'models' | 'prompts') => void;
}

const AppSidebar: React.FC<AppSidebarProps> = ({ novels, currentNovelId, onSelect, onCreate, onDelete, currentView, onNavigate }) => {
  const [isLibraryExpanded, setIsLibraryExpanded] = useState(true);
  
  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
  };

  return (
    <div className="w-64 bg-gray-900 text-gray-300 flex flex-col h-full border-r border-gray-800 shrink-0 transition-all duration-300">
      {/* Branding */}
      <div className="p-4 flex items-center space-x-2 text-white border-b border-gray-800">
        <Layout className="w-6 h-6 text-indigo-500" />
        <span className="font-serif font-bold text-lg tracking-wide">DreamWeaver</span>
      </div>

      {/* Primary Actions */}
      <div className="p-4 space-y-2">
        <button
          onClick={() => {
              onNavigate('workspace');
              onCreate();
          }}
          className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg transition-all shadow-lg hover:shadow-indigo-500/25 font-medium text-sm group"
        >
          <Plus size={18} className="group-hover:rotate-90 transition-transform duration-200" />
          <span>新建作品 (New)</span>
        </button>
      </div>

      {/* List Header */}
      <div 
        className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center justify-between cursor-pointer hover:text-gray-300 transition-colors select-none"
        onClick={() => setIsLibraryExpanded(!isLibraryExpanded)}
      >
        <div className="flex items-center space-x-2">
            <Book size={12} />
            <span>已生成 (Library)</span>
        </div>
        {isLibraryExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </div>

      {/* Novel List */}
      {isLibraryExpanded && (
        <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-4 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
            {novels.length === 0 ? (
            <div className="text-center py-8 px-4 text-gray-600 text-xs">
                <p>暂无作品</p>
                <p>点击上方按钮开始创作</p>
            </div>
            ) : (
            novels.map((novel) => (
                <div
                key={novel.id}
                className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all duration-200 ${
                    currentView === 'workspace' && currentNovelId === novel.id
                    ? 'bg-gray-800 text-white shadow-sm ring-1 ring-gray-700'
                    : 'hover:bg-gray-800/50 hover:text-gray-100'
                }`}
                onClick={() => {
                    onNavigate('workspace');
                    onSelect(novel.id);
                }}
                >
                <div className="flex items-center space-x-3 overflow-hidden">
                    <FileText size={16} className={`shrink-0 ${currentView === 'workspace' && currentNovelId === novel.id ? 'text-indigo-400' : 'text-gray-600 group-hover:text-gray-400'}`} />
                    <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">{novel.title || "Untitled"}</span>
                    <span className="text-[10px] text-gray-500 truncate">{formatDate(novel.updatedAt)}</span>
                    </div>
                </div>
                
                <button
                    onClick={(e) => {
                    e.stopPropagation();
                    onDelete(novel.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 text-gray-500 hover:text-red-400 rounded transition-all"
                    title="Delete"
                >
                    <Trash2 size={14} />
                </button>
                </div>
            ))
            )}
        </div>
      )}
      
      {!isLibraryExpanded && <div className="flex-1"></div>}

      <div className="my-2 border-t border-gray-800 mx-4"></div>

      {/* Navigation Menu (Bottom) */}
      <div className="px-2 space-y-1 pb-2">
         <button
            onClick={() => onNavigate('prompts')}
            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                currentView === 'prompts' 
                ? 'bg-gray-800 text-white shadow-sm ring-1 ring-gray-700' 
                : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
            }`}
         >
             <MessageSquareQuote size={18} />
             <span>提示词配置 (Prompts)</span>
         </button>
         <button
            onClick={() => onNavigate('models')}
            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                currentView === 'models' 
                ? 'bg-gray-800 text-white shadow-sm ring-1 ring-gray-700' 
                : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
            }`}
         >
             <Cpu size={18} />
             <span>模型配置 (Models)</span>
         </button>
      </div>
      
      {/* Footer Info */}
      <div className="p-4 border-t border-gray-800 text-[10px] text-gray-600 text-center flex justify-between items-center">
         <span>v1.1.0</span>
         <span className="flex items-center gap-1"><Settings size={10}/> Settings</span>
      </div>
    </div>
  );
};

export default AppSidebar;
