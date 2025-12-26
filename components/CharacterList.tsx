import React from 'react';
import { Character } from '../types';
import { Users, X } from 'lucide-react';

interface CharacterListProps {
  characters: Character[];
  isOpen: boolean;
  onClose: () => void;
}

const CharacterList: React.FC<CharacterListProps> = ({ characters, isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center space-x-2 text-indigo-700">
            <Users className="w-5 h-5" />
            <h3 className="text-lg font-bold">人物设定 (Character Profiles)</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
          {characters.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p>暂无人物数据 (No characters generated yet)</p>
            </div>
          ) : (
            characters.map((char, index) => (
              <div key={index} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="text-base font-bold text-gray-900">{char.name}</h4>
                  <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium border border-indigo-100">
                    {char.role}
                  </span>
                </div>
                <div className="space-y-2 text-sm text-gray-600">
                  <p className="leading-relaxed"><span className="font-semibold text-gray-700">简介:</span> {char.description}</p>
                  <p className="leading-relaxed bg-gray-50 p-2 rounded text-xs"><span className="font-semibold text-gray-700">人物关系:</span> {char.relationships}</p>
                </div>
              </div>
            ))
          )}
        </div>
        
        <div className="p-4 border-t border-gray-100 bg-white text-center text-xs text-gray-400 rounded-b-xl">
           共 {characters.length} 名主要角色
        </div>
      </div>
    </div>
  );
};

export default CharacterList;
