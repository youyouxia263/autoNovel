
import React, { useState } from 'react';
import { NovelSettings } from '../types';
import { Database, HardDrive, Server, Save, CheckCircle2, FolderOpen } from 'lucide-react';
import { DAOFactory } from '../services/dao';

interface StorageConfigManagerProps {
    settings: NovelSettings;
    onSettingsChange: (settings: NovelSettings) => void;
}

const StorageConfigManager: React.FC<StorageConfigManagerProps> = ({ settings, onSettingsChange }) => {
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

    const handleStorageChange = (field: string, value: any) => {
        onSettingsChange({
            ...settings,
            storage: {
                ...settings.storage,
                [field]: value
            }
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Test connection or just persist current state logic
            const dao = DAOFactory.getDAO(settings);
            await dao.init(); // Try to init to test
            
            setSaveMessage('设置已应用 (Settings Applied)');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e: any) {
            setSaveMessage('Error: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto bg-gray-50 p-8">
            <div className="max-w-3xl mx-auto">
                <header className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <Database className="text-indigo-600" />
                        持久化存储配置 (Persistence Config)
                    </h2>
                    <p className="text-gray-500 text-sm mt-1">
                        Configure where your novels and chapters are stored.
                    </p>
                </header>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
                    
                    {/* Storage Type Selection */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-3">存储类型 (Storage Type)</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className={`cursor-pointer border rounded-xl p-4 flex items-start space-x-3 transition-all ${
                                settings.storage.type === 'sqlite' 
                                ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' 
                                : 'border-gray-200 hover:bg-gray-50'
                            }`}>
                                <input 
                                    type="radio" 
                                    name="storageType" 
                                    value="sqlite"
                                    checked={settings.storage.type === 'sqlite'}
                                    onChange={() => handleStorageChange('type', 'sqlite')}
                                    className="mt-1 text-emerald-600 focus:ring-emerald-500"
                                />
                                <div>
                                    <div className="flex items-center gap-2 font-bold text-gray-800">
                                        <HardDrive size={18} />
                                        <span>本地数据库 (SQLite)</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Use a local SQLite database file. Requires backend adapter or local file access setup.
                                    </p>
                                </div>
                            </label>

                            <label className={`cursor-pointer border rounded-xl p-4 flex items-start space-x-3 transition-all ${
                                settings.storage.type === 'mysql' 
                                ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' 
                                : 'border-gray-200 hover:bg-gray-50'
                            }`}>
                                <input 
                                    type="radio" 
                                    name="storageType" 
                                    value="mysql"
                                    checked={settings.storage.type === 'mysql'}
                                    onChange={() => handleStorageChange('type', 'mysql')}
                                    className="mt-1 text-indigo-600 focus:ring-indigo-500"
                                />
                                <div>
                                    <div className="flex items-center gap-2 font-bold text-gray-800">
                                        <Server size={18} />
                                        <span>远程数据库 (Remote MySQL)</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Connect to a remote MySQL server via API. Requires backend setup.
                                    </p>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* SQLite Details */}
                    {settings.storage.type === 'sqlite' && (
                         <div className="pt-4 border-t border-gray-100 animate-in fade-in slide-in-from-top-2">
                             <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                                <HardDrive size={16} /> SQLite Configuration
                             </h3>
                             <div>
                                 <label className="block text-xs font-semibold text-gray-500 mb-1">Database File Path (Local)</label>
                                 <div className="relative">
                                    <input 
                                        type="text" 
                                        placeholder="./data/novel_db.sqlite" 
                                        readOnly
                                        value="./data/novel_db.sqlite"
                                        className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                                    />
                                    <FolderOpen size={18} className="absolute right-3 top-2.5 text-gray-400" />
                                 </div>
                                 <p className="text-[10px] text-gray-400 mt-1">
                                    * Current web version simulates SQLite using IndexedDB for browser compatibility. Native SQLite requires a backend service.
                                 </p>
                             </div>
                        </div>
                    )}

                    {/* MySQL Details */}
                    {settings.storage.type === 'mysql' && (
                        <div className="pt-4 border-t border-gray-100 animate-in fade-in slide-in-from-top-2">
                             <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                                <Server size={16} /> Connection Details
                             </h3>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                 <div>
                                     <label className="block text-xs font-semibold text-gray-500 mb-1">Host</label>
                                     <input 
                                        type="text" 
                                        placeholder="localhost" 
                                        value={settings.storage.mysqlHost || ''}
                                        onChange={(e) => handleStorageChange('mysqlHost', e.target.value)}
                                        className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                     />
                                 </div>
                                 <div>
                                     <label className="block text-xs font-semibold text-gray-500 mb-1">Port</label>
                                     <input 
                                        type="text" 
                                        placeholder="3306" 
                                        value={settings.storage.mysqlPort || ''}
                                        onChange={(e) => handleStorageChange('mysqlPort', e.target.value)}
                                        className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                     />
                                 </div>
                                 <div>
                                     <label className="block text-xs font-semibold text-gray-500 mb-1">User</label>
                                     <input 
                                        type="text" 
                                        placeholder="root" 
                                        value={settings.storage.mysqlUser || ''}
                                        onChange={(e) => handleStorageChange('mysqlUser', e.target.value)}
                                        className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                     />
                                 </div>
                                 <div>
                                     <label className="block text-xs font-semibold text-gray-500 mb-1">Database</label>
                                     <input 
                                        type="text" 
                                        placeholder="novel_db" 
                                        value={settings.storage.mysqlDatabase || ''}
                                        onChange={(e) => handleStorageChange('mysqlDatabase', e.target.value)}
                                        className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                     />
                                 </div>
                                 <div className="md:col-span-2">
                                     <label className="block text-xs font-semibold text-gray-500 mb-1">Password</label>
                                     <input 
                                        type="password" 
                                        placeholder="••••••" 
                                        value={settings.storage.mysqlPassword || ''}
                                        onChange={(e) => handleStorageChange('mysqlPassword', e.target.value)}
                                        className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                     />
                                 </div>
                             </div>
                        </div>
                    )}

                    <div className="pt-4 flex items-center justify-end border-t border-gray-100">
                         {saveMessage && (
                             <span className="text-sm text-green-600 flex items-center gap-1 mr-4 animate-in fade-in">
                                 <CheckCircle2 size={16} /> {saveMessage}
                             </span>
                         )}
                         <button 
                            onClick={handleSave}
                            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-2 font-medium transition-colors shadow-sm"
                         >
                            <Save size={18} />
                            <span>应用配置 (Apply)</span>
                         </button>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default StorageConfigManager;
