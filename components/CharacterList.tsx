import React from 'react';
import { Character, NovelSettings } from '../types';
import { Users, X, Copy, Download, Check, Edit2, Save, Plus, Trash2, Sparkles, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { generateSingleCharacter } from '../services/geminiService';

interface CharacterListProps {
  characters: Character[];
  isOpen: boolean;
  onClose: () => void;
  onUpdateCharacters?: (characters: Character[]) => void;
  settings?: NovelSettings;
}

const CharacterList: React.FC<CharacterListProps> = ({ characters, isOpen, onClose, onUpdateCharacters, settings }) => {
  const [copied, setCopied] = useState(false);
  const [localCharacters, setLocalCharacters] = useState<Character[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Character>({ name: '', role: '', description: '', relationships: '' });
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    setLocalCharacters(characters);
  }, [characters, isOpen]);

  if (!isOpen) return null;

  const handleCopyAll = async () => {
      const text = localCharacters.map(c => 
        `NAME: ${c.name}\nROLE: ${c.role}\nDESCRIPTION: ${c.description}\nRELATIONSHIPS: ${c.relationships}\n`
      ).join('\n---\n\n');
      
      try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
      } catch (err) {
          console.error("Failed to copy", err);
      }
  };

  const handleExportTxt = () => {
      const text = localCharacters.map(c => 
        `NAME: ${c.name}\nROLE: ${c.role}\nDESCRIPTION: ${c.description}\nRELATIONSHIPS: ${c.relationships}\n`
      ).join('\n---\n\n');
      
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `characters_profiles.txt`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const startEditing = (index: number) => {
      setEditingIndex(index);
      setEditForm({ ...localCharacters[index] });
  };

  const saveEditing = () => {
      if (editingIndex === null) return;
      
      const updated = [...localCharacters];
      updated[editingIndex] = editForm;
      setLocalCharacters(updated);
      
      if (onUpdateCharacters) {
          onUpdateCharacters(updated);
      }
      
      setEditingIndex(null);
  };

  const addNewCharacter = () => {
      const newChar = { name: '新角色', role: '配角', description: '待补充...', relationships: '待补充...' };
      const updated = [newChar, ...localCharacters];
      setLocalCharacters(updated);
      if (onUpdateCharacters) onUpdateCharacters(updated);
      setEditingIndex(0); // Auto start editing the new one
      setEditForm(newChar);
  };

  const handleAiAddCharacter = async () => {
      if (!settings) {
          alert("Settings context missing.");
          return;
      }
      setIsGenerating(true);
      try {
          const newChar = await generateSingleCharacter(settings, localCharacters);
          const updated = [newChar, ...localCharacters];
          setLocalCharacters(updated);
          if (onUpdateCharacters) onUpdateCharacters(updated);
      } catch (e) {
          console.error(e);
          alert("Failed to generate character.");
      } finally {
          setIsGenerating(false);
      }
  };

  const deleteCharacter = (index: number) => {
      if (!window.confirm("确定要删除这个角色吗？")) return;
      const updated = localCharacters.filter((_, i) => i !== index);
      setLocalCharacters(updated);
      if (onUpdateCharacters) onUpdateCharacters(updated);
      if (editingIndex === index) setEditingIndex(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center space-x-2 text-indigo-700">
            <Users className="w-5 h-5" />
            <h3 className="text-lg font-bold">人物设定 (Character Profiles)</h3>
          </div>
          <div className="flex items-center space-x-2">
             {settings && (
                 <button
                    onClick={handleAiAddCharacter}
                    disabled={isGenerating}
                    className="p-1.5 hover:bg-purple-50 rounded-lg text-purple-600 transition-colors flex items-center space-x-1 border border-purple-100"
                    title="AI Generate Character"
                 >
                    {isGenerating ? <Loader2 size={18} className="animate-spin"/> : <Sparkles size={18} />}
                    <span className="text-xs font-medium hidden sm:inline">AI Add</span>
                 </button>
             )}
             <button
                onClick={addNewCharacter}
                className="p-1.5 hover:bg-indigo-50 rounded-lg text-indigo-600 transition-colors flex items-center space-x-1 border border-indigo-100"
                title="Add Character"
             >
                <Plus size={18} />
                <span className="text-xs font-medium hidden sm:inline">Add</span>
             </button>
             <button
                onClick={handleCopyAll}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-indigo-600 transition-colors flex items-center space-x-1"
                title="Copy all characters"
             >
                {copied ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                <span className="text-xs font-medium hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
             </button>
             <button
                onClick={handleExportTxt}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-indigo-600 transition-colors flex items-center space-x-1"
                title="Export as TXT"
             >
                <Download size={18} />
                <span className="text-xs font-medium hidden sm:inline">Export</span>
             </button>
             <div className="h-4 w-px bg-gray-200 mx-1"></div>
             <button 
                onClick={onClose}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
             >
                <X size={20} />
             </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
          {localCharacters.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p>暂无人物数据 (No characters generated yet)</p>
            </div>
          ) : (
            localCharacters.map((char, index) => (
              <div key={index} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow relative group">
                {editingIndex === index ? (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                                <input 
                                    value={editForm.name}
                                    onChange={e => setEditForm({...editForm, name: e.target.value})}
                                    className="w-full text-sm border p-1 rounded"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                                <input 
                                    value={editForm.role}
                                    onChange={e => setEditForm({...editForm, role: e.target.value})}
                                    className="w-full text-sm border p-1 rounded"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                            <textarea 
                                value={editForm.description}
                                onChange={e => setEditForm({...editForm, description: e.target.value})}
                                className="w-full text-sm border p-1 rounded h-20"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Relationships</label>
                            <textarea 
                                value={editForm.relationships}
                                onChange={e => setEditForm({...editForm, relationships: e.target.value})}
                                className="w-full text-sm border p-1 rounded h-16"
                            />
                        </div>
                        <div className="flex justify-end space-x-2 pt-2">
                             <button onClick={() => deleteCharacter(index)} className="p-1 text-red-500 hover:bg-red-50 rounded">
                                 <Trash2 size={16} />
                             </button>
                             <div className="flex-1"></div>
                             <button onClick={() => setEditingIndex(null)} className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                             <button onClick={saveEditing} className="px-3 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center space-x-1">
                                <Save size={14}/> <span>Save</span>
                             </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex justify-between items-start mb-2">
                            <h4 className="text-base font-bold text-gray-900">{char.name}</h4>
                            <div className="flex items-center space-x-2">
                                <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium border border-indigo-100">
                                    {char.role}
                                </span>
                                {onUpdateCharacters && (
                                    <button 
                                        onClick={() => startEditing(index)}
                                        className="text-gray-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="space-y-2 text-sm text-gray-600">
                            <p className="leading-relaxed"><span className="font-semibold text-gray-700">简介:</span> {char.description}</p>
                            <p className="leading-relaxed bg-gray-50 p-2 rounded text-xs"><span className="font-semibold text-gray-700">人物关系:</span> {char.relationships}</p>
                        </div>
                    </>
                )}
              </div>
            ))
          )}
        </div>
        
        <div className="p-4 border-t border-gray-100 bg-white text-center text-xs text-gray-400 rounded-b-xl">
           共 {localCharacters.length} 名主要角色
        </div>
      </div>
    </div>
  );
};

export default CharacterList;