import React from 'react';
import { GrammarIssue } from '../types';
import { X, SpellCheck, Wand2, Loader2, CheckCircle } from 'lucide-react';

interface GrammarReportProps {
  isOpen: boolean;
  onClose: () => void;
  issues: GrammarIssue[];
  onAutoFix: () => void;
  isFixing: boolean;
}

const GrammarReport: React.FC<GrammarReportProps> = ({ isOpen, onClose, issues, onAutoFix, isFixing }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200 border border-gray-100">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center space-x-2 text-indigo-600">
            <SpellCheck className="w-5 h-5" />
            <h3 className="text-lg font-bold">语法与拼写检查 (Grammar Check)</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/50">
           
           {/* Summary */}
           <div className="p-4 bg-white rounded-lg border border-gray-200 flex justify-between items-center shadow-sm">
                <div>
                   <h4 className="font-bold text-gray-800">发现 {issues.length} 个潜在问题</h4>
                   <p className="text-xs text-gray-500 mt-1">Review suggestions below or use Auto-Fix.</p>
                </div>
                <button
                    onClick={onAutoFix}
                    disabled={isFixing || issues.length === 0}
                    className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isFixing ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                    <span>一键修复 (Auto Fix)</span>
                </button>
           </div>

           {issues.length === 0 && (
             <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <CheckCircle size={48} className="text-green-500 mb-3 opacity-50" />
                <p>未发现明显的语法错误。</p>
                <p className="text-sm">Great job! No issues found.</p>
             </div>
           )}

           {/* Issues List */}
           <div className="space-y-4">
               {issues.map((issue, idx) => (
                   <div key={idx} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow group">
                       <div className="grid grid-cols-1 gap-3">
                           <div className="bg-red-50 p-2 rounded text-red-700 text-sm line-through decoration-red-400 decoration-2">
                               {issue.original}
                           </div>
                           <div className="flex items-center text-green-700 text-sm font-medium bg-green-50 p-2 rounded">
                               <Wand2 size={14} className="mr-2" />
                               {issue.suggestion}
                           </div>
                           <div className="text-xs text-gray-500 italic border-t border-gray-50 pt-2 mt-1">
                               Explanation: {issue.explanation}
                           </div>
                       </div>
                   </div>
               ))}
           </div>
        </div>
      </div>
    </div>
  );
};

export default GrammarReport;