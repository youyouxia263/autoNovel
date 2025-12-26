
export enum Genre {
  Suspense = 'Suspense',
  Romance = 'Romance',
  Thriller = 'Thriller',
  Mystery = 'Mystery',
  Fantasy = 'Fantasy',
  SciFi = 'Sci-Fi'
}

export type Language = 'zh' | 'en';

export type ModelProvider = 'gemini' | 'alibaba' | 'volcano' | 'custom';

export type WritingTone = 'Neutral' | 'Dark' | 'Humorous' | 'Melancholic' | 'Fast-paced' | 'Romantic' | 'Cynical';
export type WritingStyle = 'Simple' | 'Moderate' | 'Complex' | 'Poetic';
export type NarrativePerspective = 'First Person' | 'Third Person Limited' | 'Third Person Omniscient';

export interface NovelSettings {
  title: string;
  premise: string;
  genre: Genre;
  targetWordCount: number;
  chapterCount: number;
  language: Language;
  // Model Configuration
  provider: ModelProvider;
  baseUrl?: string; // For custom providers
  apiKey?: string; // Optional for Gemini (uses env), required for others
  modelName?: string; // e.g., 'qwen-plus', 'ep-2024...'
  
  // Style Configuration
  writingTone: WritingTone;
  writingStyle: WritingStyle;
  narrativePerspective: NarrativePerspective;
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
  consistencyAnalysis?: string; // Result of the consistency check
}

export interface NovelState {
  settings: NovelSettings;
  chapters: Chapter[];
  characters: Character[];
  currentChapterId: number | null;
  status: 'idle' | 'generating_outline' | 'ready';
}
