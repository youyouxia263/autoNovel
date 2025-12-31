
import { NovelState, NovelSettings, Chapter, Character, ModelConfig } from "../types";

// --- DAO Interface ---
export interface INovelDAO {
  init(): Promise<void>;
  saveNovel(state: NovelState): Promise<string>; // Returns ID
  loadNovel(id: string): Promise<NovelState | null>;
  listNovels(): Promise<{ id: string; title: string; updatedAt: Date }[]>;
  deleteNovel(id: string): Promise<void>;
  
  // Model Config Methods
  saveModelConfig(config: ModelConfig): Promise<string>;
  listModelConfigs(): Promise<ModelConfig[]>;
  deleteModelConfig(id: string): Promise<void>;
}

// --- Local SQLite-like Adapter (Using IndexedDB) ---
class LocalDAO implements INovelDAO {
  private dbName = "DreamWeaverDB";
  private dbVersion = 2; // Incremented version for new store
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject("Database failed to open");

      request.onsuccess = (event: any) => {
        this.db = event.target.result;
        resolve();
      };

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        // Novels Table - Stores the full JSON blob of the novel state
        if (!db.objectStoreNames.contains("novels")) {
          db.createObjectStore("novels", { keyPath: "id" });
        }
        // Metadata Table for list views
        if (!db.objectStoreNames.contains("metadata")) {
            db.createObjectStore("metadata", { keyPath: "id" });
        }
        // Model Configs Table
        if (!db.objectStoreNames.contains("model_configs")) {
            db.createObjectStore("model_configs", { keyPath: "id" });
        }
      };
    });
  }

  async saveNovel(state: NovelState): Promise<string> {
    if (!this.db) await this.init();
    
    // Ensure ID exists
    const id = state.settings.id || crypto.randomUUID();
    
    // Create a storage object that includes the ID at the root level for IndexedDB keyPath
    // We preserve the full state including characters and their relationships
    const storageObject = {
        id: id,
        ...state,
        settings: { ...state.settings, id },
        lastSaved: new Date()
    };

    const tx = this.db!.transaction(["novels", "metadata"], "readwrite");
    
    // Save full state (Books, Chapters, Content, Characters, Relationships, World View, Styles, etc.)
    tx.objectStore("novels").put(storageObject);

    // Save metadata for listing
    tx.objectStore("metadata").put({
        id,
        title: state.settings.title,
        updatedAt: storageObject.lastSaved
    });

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadNovel(id: string): Promise<NovelState | null> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction("novels", "readonly");
      const store = tx.objectStore("novels");
      const request = store.get(id);
      request.onsuccess = () => {
          const result = request.result;
          if (result) {
              // Strip the root 'id' if strictly following NovelState type, 
              // though extra props are usually fine.
              resolve(result as NovelState);
          } else {
              resolve(null);
          }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async listNovels(): Promise<{ id: string; title: string; updatedAt: Date }[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction("metadata", "readonly");
      const store = tx.objectStore("metadata");
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteNovel(id: string): Promise<void> {
      if (!this.db) await this.init();
      const tx = this.db!.transaction(["novels", "metadata"], "readwrite");
      tx.objectStore("novels").delete(id);
      tx.objectStore("metadata").delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  }

  // --- Model Config Implementation ---

  async saveModelConfig(config: ModelConfig): Promise<string> {
      if (!this.db) await this.init();
      const id = config.id || crypto.randomUUID();
      const toSave = { ...config, id };
      
      const tx = this.db!.transaction("model_configs", "readwrite");
      tx.objectStore("model_configs").put(toSave);
      
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve(id);
          tx.onerror = () => reject(tx.error);
      });
  }

  async listModelConfigs(): Promise<ModelConfig[]> {
      if (!this.db) await this.init();
      return new Promise((resolve, reject) => {
          const tx = this.db!.transaction("model_configs", "readonly");
          const store = tx.objectStore("model_configs");
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  }

  async deleteModelConfig(id: string): Promise<void> {
      if (!this.db) await this.init();
      const tx = this.db!.transaction("model_configs", "readwrite");
      tx.objectStore("model_configs").delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  }
}

// --- MySQL Remote Adapter (Mock/Interface) ---
// Since we are in a browser, we cannot connect to MySQL directly via TCP.
// This adapter expects a backend API at the configured endpoint.
class MySQLDAO implements INovelDAO {
  private config: NovelSettings['storage'];

  constructor(config: NovelSettings['storage']) {
      this.config = config;
  }

  async init(): Promise<void> {
      console.log("Initializing MySQL Adapter via API...", this.config);
      return Promise.resolve();
  }

  async saveNovel(state: NovelState): Promise<string> {
      console.log("Saving to MySQL...", state);
      await new Promise(r => setTimeout(r, 500));
      return state.settings.id || crypto.randomUUID();
  }

  async loadNovel(id: string): Promise<NovelState | null> {
      console.log("Loading from MySQL...", id);
      return null;
  }

  async listNovels(): Promise<{ id: string; title: string; updatedAt: Date }[]> {
      return [];
  }

  async deleteNovel(id: string): Promise<void> {
      console.log("Deleting from MySQL...", id);
  }

  async saveModelConfig(config: ModelConfig): Promise<string> {
      // Mock save
      return config.id || crypto.randomUUID();
  }
  
  async listModelConfigs(): Promise<ModelConfig[]> {
      return [];
  }
  
  async deleteModelConfig(id: string): Promise<void> {}
}

// --- Factory ---
export class DAOFactory {
    static getDAO(settings: NovelSettings): INovelDAO {
        if (settings.storage.type === 'mysql') {
            return new MySQLDAO(settings.storage);
        }
        return new LocalDAO();
    }
}
