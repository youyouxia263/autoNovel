import React from 'react';
import { Chapter } from '../types';
import { X, CheckCircle2, AlertTriangle, FileSearch, Wrench, Loader2 } from 'lucide-react';

interface ConsistencyReportProps {
  chapters: Chapter[];
  isOpen: boolean;
  onClose: () => void;
  onFixConsistency?: (chapterId: number) => void;
}

const ConsistencyReport: React.FC<ConsistencyReportProps> = ({ chapters, isOpen, onClose, onFixConsistency }) => {
  if (!isOpen) return null;

  const chaptersWithIssues = chapters.filter(c => c.consistencyAnalysis && c.consistencyAnalysis !== "Consistent" && !c.consistencyAnalysis.startsWith("Fixed"));
  const consistentChapters = chapters.filter(c => c.consistencyAnalysis === "Consistent" || c.consistencyAnalysis?.startsWith("Fixed"));
  const uncheckedChapters = chapters.filter(c => !c.consistencyAnalysis && c.isDone);

  const hasIssues = chaptersWithIssues.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200 border border-gray-100">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center space-x-2 text-orange-600">
            <FileSearch className="w-5 h-5" />
            <h3 className="text-lg font-bold">一致性校验报告 (Consistency Report)</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/50">
           
           {/* Summary Status */}
           <div className={`p-4 rounded-lg border flex items-start space-x-3 ${hasIssues ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
                {hasIssues ? <AlertTriangle className="text-orange-500 shrink-0 mt-0.5" /> : <CheckCircle2 className="text-green-500 shrink-0 mt-0.5" />}
                <div>
                    <h4 className={`font-bold text-sm ${hasIssues ? 'text-orange-800' : 'text-green-800'}`}>
                        {hasIssues ? `发现 ${chaptersWithIssues.length} 个章节存在潜在问题` : "未发现明显的一致性问题"}
                    </h4>
                    <p className={`text-xs mt-1 ${hasIssues ? 'text-orange-600' : 'text-green-600'}`}>
                        {hasIssues 
                         ? "请检查下列章节的详细报告，或使用 'AI 修复' 功能。" 
                         : "所有已检查的章节在角色行为和关系上似乎保持一致。"}
                    </p>
                </div>
           </div>

           {/* Issues List */}
           {hasIssues && (
             <div className="space-y-4">
                <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">详细问题 (Details)</h4>
                {chaptersWithIssues.map(chapter => (
                    <div key={chapter.id} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-50">
                            <span className="font-bold text-gray-800 text-sm">第 {chapter.id} 章: {chapter.title}</span>
                            
                            {onFixConsistency && (
                                <button 
                                    onClick={() => onFixConsistency(chapter.id)}
                                    disabled={chapter.isGenerating}
                                    className="flex items-center space-x-1 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-medium rounded-full transition-colors disabled:opacity-50"
                                >
                                    {chapter.isGenerating ? <Loader2 size={12} className="animate-spin"/> : <Wrench size={12} />}
                                    <span>{chapter.isGenerating ? "修复中..." : "AI 自动修复 (Auto Fix)"}</span>
                                </button>
                            )}
                        </div>
                        <div className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
                            {chapter.consistencyAnalysis}
                        </div>
                    </div>
                ))}
             </div>
           )}

           {/* Stats Footer */}
           <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200">
               <div className="text-center">
                   <div className="text-lg font-bold text-gray-700">{chaptersWithIssues.length}</div>
                   <div className="text-[10px] text-gray-400 uppercase">Issues</div>
               </div>
               <div className="text-center">
                   <div className="text-lg font-bold text-gray-700">{consistentChapters.length}</div>
                   <div className="text-[10px] text-gray-400 uppercase">Passed/Fixed</div>
               </div>
               <div className="text-center">
                   <div className="text-lg font-bold text-gray-700">{uncheckedChapters.length}</div>
                   <div className="text-[10px] text-gray-400 uppercase">Not Checked</div>
               </div>
           </div>

        </div>
      </div>
    </div>
  );
};

export default ConsistencyReport;