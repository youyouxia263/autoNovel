
export type Language = 'zh' | 'en';
export type NovelType = 'long' | 'short';

export type ModelProvider = 'gemini' | 'alibaba' | 'volcano' | 'custom';

export type WritingTone = 'Neutral' | 'Dark' | 'Humorous' | 'Melancholic' | 'Fast-paced' | 'Romantic' | 'Cynical';
export type WritingStyle = 'Simple' | 'Moderate' | 'Complex' | 'Poetic';
export type NarrativePerspective = 'First Person' | 'Third Person Limited' | 'Third Person Omniscient';

export type StorageType = 'sqlite' | 'mysql';

export interface StorageConfig {
  type: StorageType;
  // MySQL specific config
  mysqlHost?: string;
  mysqlPort?: string;
  mysqlUser?: string;
  mysqlPassword?: string;
  mysqlDatabase?: string;
}

export interface ModelConfig {
  id: string;
  name: string; // User defined name (e.g. "My Paid GPT")
  provider: ModelProvider;
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
  maxOutputTokens?: number;
  createdAt: Date;
}

// Tomato Novel Classification Types
export interface TagOption {
    id: string;
    label: string;
}

export interface NovelSettings {
  id?: string; // UUID for persistence
  title: string;
  premise: string;
  
  // New Classification System
  mainCategory: string; // Subject (Genre) - Single Select
  themes: string[];     // World/Core - Select 1-3
  roles: string[];      // Character Attributes - Select 1-2
  plots: string[];      // Plot/Vibe - Select 1-3

  novelType: NovelType;
  targetWordCount: number;
  chapterCount: number;
  language: Language;
  worldSetting?: string;
  mainCharacters?: string; 
  
  // Model Configuration (Active Session)
  provider: ModelProvider;
  baseUrl?: string; 
  apiKey?: string; 
  modelName?: string; 
  maxOutputTokens?: number; 
  
  // Prompt Configuration
  customPrompts?: Record<string, string>; // Key: template_id, Value: user modified template

  // Style Configuration
  writingTone: WritingTone;
  writingStyle: WritingStyle;
  narrativePerspective: NarrativePerspective;

  // Storage Configuration
  storage: StorageConfig;
}

export interface AppearanceSettings {
  fontFamily: 'font-serif' | 'font-sans' | 'font-lora';
  fontSize: 'text-sm' | 'text-base' | 'text-lg' | 'text-xl';
  lineHeight: 'leading-tight' | 'leading-normal' | 'leading-loose' | 'leading-relaxed';
  textAlign: 'text-left' | 'text-justify';
  theme: 'light' | 'sepia' | 'dark';
}

export interface Character {
  name: string;
  role: string;
  description: string;
  relationships: string;
}

export interface Chapter {
  id: number;
  title: string;
  summary: string;
  content: string;
  isGenerating: boolean;
  isDone: boolean;
  consistencyAnalysis?: string;
}

export interface GrammarIssue {
  original: string;
  suggestion: string;
  explanation: string;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
}

export interface NovelState {
  settings: NovelSettings;
  chapters: Chapter[];
  characters: Character[];
  currentChapterId: number | null;
  status: 'idle' | 'generating_outline' | 'ready';
  consistencyReport?: string | null;
  usage: UsageStats; 
  lastSaved?: Date; // Track save time
}
