import { GoogleGenAI, Type, Schema } from "@google/genai";
import { NovelSettings, Chapter, ModelProvider, Character, GrammarIssue, Genre } from "../types";

const GEMINI_API_KEY = process.env.API_KEY || '';

// --- Universal Helpers ---

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to handle cancellation
async function wrapWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return new Promise((resolve, reject) => {
        const abortHandler = () => {
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', abortHandler);
        promise.then(
            res => {
                signal.removeEventListener('abort', abortHandler);
                resolve(res);
            },
            err => {
                signal.removeEventListener('abort', abortHandler);
                reject(err);
            }
        );
    });
}

// Helper to sanitize system instructions for strict providers
const getSystemInstruction = (base: string, settings: NovelSettings) => {
    if (settings.provider === 'alibaba') {
        return `${base}\nSAFETY REQUIREMENT: Output must be safe for general audiences. Strictly avoid explicit violence, gore, sexual content, or sensitive political topics. Describe tension psychologically or implicitly rather than graphically.`;
    }
    return base;
};

async function withRetry<T>(operation: () => Promise<T>, retries = 3, baseDelay = 2000): Promise<T> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            const msg = error?.message || JSON.stringify(error);
            const isRateLimit = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
            const isServer = msg.includes('500') || msg.includes('503') || msg.includes('Overloaded');
            const isNetwork = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch failed');
            const isAborted = msg.includes('Aborted') || error.name === 'AbortError';
            // Don't retry safety blocks
            const isSafetyBlock = msg.includes('data_inspection_failed') || msg.includes('inappropriate content');

            if (isAborted || isSafetyBlock) throw error; 
            
            if ((isRateLimit || isServer || isNetwork) && i < retries - 1) {
                const delay = baseDelay * Math.pow(2, i); // 2s, 4s, 8s
                console.warn(`API Error (${msg}). Retrying in ${delay}ms...`);
                await wait(delay);
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

function cleanAndParseJson(text: string) {
    if (!text) return [];
    let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    const tryParse = (str: string) => {
        try { return JSON.parse(str); } catch (e) { return null; }
    };

    let result = tryParse(clean);
    if (result) return result;

    const fixUnquoted = (str: string) => {
        const keys = ['summary', 'title', 'description', 'relationships', 'name', 'role', 'content', 'id', 'original', 'suggestion', 'explanation'];
        let fixed = str;
        keys.forEach(key => {
             if (key === 'id') return;
             const regex = new RegExp(`"${key}"\\s*:\\s*(?![{\\["\\d]|true|false|null)([^,}\\]]+)`, 'g');
             fixed = fixed.replace(regex, (match, val) => {
                const trimmed = val.trim();
                if (!isNaN(Number(trimmed))) return match; 
                return `"${key}": "${trimmed.replace(/"/g, '\\"')}"`;
             });
        });
        return fixed;
    };
    
    result = tryParse(fixUnquoted(clean));
    if (result) return result;

    const firstBracket = clean.indexOf('[');
    const lastBracket = clean.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        const arrayStr = clean.substring(firstBracket, lastBracket + 1);
        result = tryParse(arrayStr);
        if (result) return result;
        result = tryParse(fixUnquoted(arrayStr));
        if (result) return result;
    }
    
    const firstCurly = clean.indexOf('{');
    const lastCurly = clean.lastIndexOf('}');
    if (firstCurly !== -1 && lastCurly !== -1 && lastCurly > firstCurly) {
        const objStr = clean.substring(firstCurly, lastCurly + 1);
        result = tryParse(objStr);
        if (result) return result;
        result = tryParse(fixUnquoted(objStr));
        if (result) return result;
    }
    
    console.error("JSON Parse Failed. Raw:", text);
    throw new Error(`JSON Parse Error: Could not parse or repair output. Raw: ${text.slice(0, 50)}...`);
}

// --- OpenAI-Compatible Stream Parser Helper ---
async function* streamOpenAICompatible(url: string, apiKey: string, model: string, messages: any[], systemInstruction?: string, temperature: number = 0.7, maxTokens?: number, onUsage?: (u: {input: number, output: number}) => void) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  const body: any = {
    model: model,
    messages: [
       ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
       ...messages
    ],
    stream: true,
    stream_options: { include_usage: true }, // Request usage stats if supported
    temperature: temperature
  };

  if (maxTokens) {
      body.max_tokens = maxTokens;
  }

  let response: Response | null = null;
  
  for(let i=0; i<3; i++) {
      try {
        response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
             const errorText = await response.text();
             
             // Check for Alibaba Safety Error
             let errorMsg = errorText;
             try {
                const jsonErr = JSON.parse(errorText);
                errorMsg = jsonErr.error?.message || jsonErr.message || errorText;
                if (jsonErr.code === 'data_inspection_failed' || jsonErr.error?.code === 'data_inspection_failed') {
                    throw new Error("Content blocked by Alibaba safety filters. Please adjust settings to be less explicit.");
                }
             } catch(e) {}
             
             if (response.status === 400 && errorText.includes('data_inspection_failed')) {
                 throw new Error("Content blocked by Alibaba safety filters. Please adjust settings to be less explicit.");
             }

             if (response.status === 429 || response.status >= 500) {
                 throw new Error(`Provider API Error: ${response.status} ${errorMsg}`);
             }
             throw new Error(`Provider API Error: ${response.status} ${errorMsg}`);
        }
        break; 
      } catch (e: any) {
          const msg = e.message || '';
          if (msg.includes("Content blocked by")) throw e; // Don't retry safety blocks

          const isNetwork = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch failed');
          if (i === 2 || !isNetwork) throw e;
          await wait(2000 * Math.pow(2, i));
      }
  }

  if (!response || !response.body) throw new Error("Failed to get response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.slice(6);
      if (dataStr === '[DONE]') continue;

      try {
        const json = JSON.parse(dataStr);
        // Track usage if present in chunk
        if (json.usage && onUsage) {
            onUsage({
                input: json.usage.prompt_tokens || 0,
                output: json.usage.completion_tokens || 0
            });
        }
        
        const content = json.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch (e) {
      }
    }
  }
}

// --- OpenAI-Compatible One-Shot Helper ---
async function fetchOpenAICompatible(url: string, apiKey: string, model: string, messages: any[], systemInstruction?: string, signal?: AbortSignal, maxTokens?: number, onUsage?: (u: {input: number, output: number}) => void) {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const body: any = {
        model: model,
        messages: [
             ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
             ...messages
        ],
        stream: false
    };

    if (maxTokens) {
        body.max_tokens = maxTokens;
    }

    return await withRetry(async () => {
        const response = await fetch(url, { 
            method: 'POST', 
            headers, 
            body: JSON.stringify(body),
            signal 
        });
        if(!response.ok) {
            const txt = await response.text();
            let msg = txt;
            try {
                const json = JSON.parse(txt);
                msg = json.error?.message || json.message || txt;
                if (json.code === 'data_inspection_failed' || json.error?.code === 'data_inspection_failed') {
                    throw new Error("Content blocked by Alibaba safety filters. Please adjust settings to be less explicit.");
                }
            } catch (e) {}
            
            if (txt.includes('data_inspection_failed')) {
                throw new Error("Content blocked by Alibaba safety filters. Please adjust settings to be less explicit.");
            }

            throw new Error(`API Error: ${response.status} ${msg}`);
        }
        const json = await response.json();
        
        if (json.usage && onUsage) {
            onUsage({
                input: json.usage.prompt_tokens || 0,
                output: json.usage.completion_tokens || 0
            });
        }

        return json.choices?.[0]?.message?.content || "";
    });
}

// --- Genre Specific Instructions ---
const getGenreSpecificInstructions = (genres: Genre[]) => {
    let instructions = "";
    genres.forEach(genre => {
        switch (genre) {
            case Genre.TimeTravel:
                instructions += `\nGENRE GUIDE - TIME TRAVEL (穿越):\n- **Core Trope**: A protagonist from modern times (or a different future) is transported to a historical or alternate world setting.\n- **Key Elements**: Contrast between modern knowledge and archaic setting.\n`;
                break;
            case Genre.Rebirth:
                instructions += `\nGENRE GUIDE - REBIRTH (重生):\n- **Core Trope**: Protagonist wakes up in their younger body.\n- **Key Elements**: "Foreknowledge", second chances, revenge.\n`;
                break;
            case Genre.Wuxia:
                instructions += `\nGENRE GUIDE - WUXIA/XIANXIA (武侠/仙侠):\n- **Key Elements**: Cultivation, martial arts sects, immortality, Jianghu.\n`;
                break;
            case Genre.Urban:
                instructions += `\nGENRE GUIDE - URBAN (都市):\n- **Key Elements**: Modern cities, career success, business empires, social dynamics.\n`;
                break;
            case Genre.System:
                instructions += `\nGENRE GUIDE - SYSTEM (系统):\n- **Key Elements**: Game-like interface, tasks, rewards, statistics.\n`;
                break;
            case Genre.Suspense:
            case Genre.Thriller:
            case Genre.Mystery:
                if (!instructions.includes("GENRE GUIDE - SUSPENSE/MYSTERY")) {
                    instructions += `\nGENRE GUIDE - SUSPENSE/MYSTERY:\n- **Key Elements**: High stakes, hidden truths, unreliable narration.\n`;
                }
                break;
            case Genre.Romance:
                instructions += `\nGENRE GUIDE - ROMANCE (言情):\n- **Key Elements**: Romantic relationship development, emotional growth, intimacy.\n`;
                break;
             case Genre.Fantasy:
                instructions += `\nGENRE GUIDE - FANTASY (玄幻):\n- **Key Elements**: Magic, supernatural elements, world-building.\n`;
                break;
             case Genre.SciFi:
                instructions += `\nGENRE GUIDE - SCI-FI (科幻):\n- **Key Elements**: Futuristic technology, space/time travel, AI.\n`;
                break;
        }
    });
    return instructions;
};

const getStyleInstructions = (settings: NovelSettings) => {
     const { writingStyle, narrativePerspective, writingTone } = settings;
    return `\n### STYLE: ${writingStyle}, ${narrativePerspective}, ${writingTone}\n`;
};

const getBaseUrl = (settings: NovelSettings) => {
    if (settings.provider === 'alibaba') return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    if (settings.provider === 'volcano') return "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
    if (settings.provider === 'custom') return settings.baseUrl || "";
    return "";
}

// --- Exported Functions ---

export const expandText = async (
    currentText: string, 
    contextType: 'World Setting' | 'Story Premise' | 'Characters', 
    settings: NovelSettings,
    onUsage?: (u: {input: number, output: number}) => void
): Promise<string> => {
    const langInstruction = settings.language === 'zh'
      ? "OUTPUT LANGUAGE: Chinese (Simplified)."
      : "OUTPUT LANGUAGE: English.";
    
    const genreString = settings.genre.join(', ');
    
    const promptText = `
      You are a creative writing assistant.
      
      Task: Expand the following ${contextType} for a ${genreString} novel titled "${settings.title}".
      ${langInstruction}
      
      Original Input:
      "${currentText}"
      
      Instructions:
      - Flesh out the details, adding depth, atmosphere, and specific elements suitable for the genre.
      - Keep the core idea but make it richer and more evocative.
      - If the input is very short, creatively brainstorm based on it.
      - Length: Approximately 200-300 words.
      - Output ONLY the expanded text.
    `;
    
    const systemInstruction = getSystemInstruction("You are an expert novelist.", settings);
  
    // Gemini Path
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;

        const response = await withRetry(() => ai.models.generateContent({
          model: model,
          contents: promptText,
          config,
        }));
        
        if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
        }
        return response.text || "";
    }
    
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    
    if (!url || !apiKey || !model) throw new Error("Missing provider configuration");
  
    return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens, onUsage);
};

export const generateCharacterConcepts = async (settings: NovelSettings, onUsage?: (u: {input: number, output: number}) => void): Promise<string> => {
    const language = settings.language;
    const genres = settings.genre;
    const langInstruction = language === 'zh' ? "OUTPUT LANGUAGE: Chinese (Simplified)." : "OUTPUT LANGUAGE: English.";
    
    const promptText = `Task: Create a list of 3-5 main characters for "${settings.title}". Genres: ${genres.join(', ')}. ${langInstruction}. Premise: ${settings.premise}. World: ${settings.worldSetting}. Provide Name, Role, and a brief description for each. Output plain text suitable for a summary.`;
    const systemInstruction = getSystemInstruction("You are a character designer.", settings);

    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config }));
        if (response.usageMetadata && onUsage) {
            onUsage({ input: response.usageMetadata.promptTokenCount || 0, output: response.usageMetadata.candidatesTokenCount || 0 });
        }
        return response.text || "";
    }
    
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    if (!url || !apiKey || !model) throw new Error("Missing config");
    return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens, onUsage);
};

export const generateSingleCharacter = async (settings: NovelSettings, existingCharacters: Character[], onUsage?: (u: {input: number, output: number}) => void): Promise<Character> => {
    const language = settings.language;
    const langInstruction = language === 'zh' ? "OUTPUT LANGUAGE: Chinese (Simplified)." : "OUTPUT LANGUAGE: English.";
    const existingNames = existingCharacters.map(c => c.name).join(', ');
    
    const promptText = `Task: Create ONE new character for "${settings.title}" who interacts with: ${existingNames}. Genres: ${settings.genre.join(', ')}. ${langInstruction}. Premise: ${settings.premise}. Provide: name, role, description, relationships.`;
    const systemInstruction = getSystemInstruction("You are a character designer.", settings);

    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const responseSchema: Schema = {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING },
                role: { type: Type.STRING },
                description: { type: Type.STRING },
                relationships: { type: Type.STRING },
            },
            required: ["name", "role", "description", "relationships"],
        };
        const config: any = { responseMimeType: "application/json", responseSchema, systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config }));
        if (response.usageMetadata && onUsage) {
            onUsage({ input: response.usageMetadata.promptTokenCount || 0, output: response.usageMetadata.candidatesTokenCount || 0 });
        }
        return cleanAndParseJson(response.text || "{}");
    }

    const jsonPrompt = `${promptText}\nIMPORTANT: Return valid JSON ONLY. Format: {"name": "...", "role": "...", "description": "...", "relationships": "..."}`;
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    if (!url || !apiKey || !model) throw new Error("Missing config");
    const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: jsonPrompt}], systemInstruction, undefined, settings.maxOutputTokens, onUsage);
    return cleanAndParseJson(text);
};

export const generateWorldSetting = async (settings: NovelSettings, onUsage?: (u: {input: number, output: number}) => void): Promise<string> => {
    const language = settings.language;
    const genres = settings.genre;
    
    const langInstruction = language === 'zh' ? "OUTPUT LANGUAGE: Chinese (Simplified)." : "OUTPUT LANGUAGE: English.";
  
    let specificPrompt = "";
    if (genres.includes(Genre.System)) {
        specificPrompt = "Define the 'System': What is its name? What are the core functions? What are the penalties?";
    } else if (genres.includes(Genre.Fantasy) || genres.includes(Genre.Wuxia)) {
        specificPrompt = "Define the Magic/Cultivation System: Power levels? Factions?";
    } else {
        specificPrompt = "Define the World Setting: Time period, location, social rules.";
    }
  
    const promptText = `Task: Create a World Setting for "${settings.title}". Genres: ${genres.join(', ')}. ${langInstruction}. Premise: ${settings.premise}. ${specificPrompt}. Keep it under 300 words.`;
    const systemInstruction = getSystemInstruction("You are a world-building expert.", settings);
  
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config }));
        
        if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
        }
        return response.text || "";
    }
    
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    if (!url || !apiKey || !model) throw new Error("Missing config");
    return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens, onUsage);
};

export const generatePremise = async (title: string, currentPremise: string, settings: NovelSettings, onUsage?: (u: {input: number, output: number}) => void): Promise<string> => {
    const language = settings.language;
    const genres = settings.genre;
    const genreString = genres.join(' + ');
    const langInstruction = language === 'zh' ? "OUTPUT LANGUAGE: Chinese (Simplified)." : "OUTPUT LANGUAGE: English.";
    const task = currentPremise && currentPremise.trim().length > 0
      ? `Expand idea: "${currentPremise}" into a plot summary.`
      : `Create a plot summary for "${title}".`;
  
    const promptText = `Task: ${task}. Genres: ${genreString}. ${langInstruction}. Return ONLY summary text.`;
    const systemInstruction = getSystemInstruction("You are a creative writing assistant.", settings);
  
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config }));
        
        if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
        }
        return response.text || "";
    }
    
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    if (!url || !apiKey || !model) throw new Error("Missing config");
    return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens, onUsage);
};

export const summarizeChapter = async (content: string, settings: NovelSettings, onUsage?: (u: {input: number, output: number}) => void): Promise<string> => {
   const genres = settings.genre.join(', ');
   const promptText = `Task: Summarize chapter. Genres: ${genres}. Content: ${content.slice(0, 15000)}. Length: 3-5 sentences.`;
   const systemInstruction = getSystemInstruction("You are an expert editor.", settings);
   
   if (settings.provider === 'gemini') {
       const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
       const model = settings.modelName || "gemini-3-flash-preview";
       const config: any = { systemInstruction };
       if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
       const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config }));
       if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
        }
       return response.text || "";
   }
   const url = getBaseUrl(settings);
   const apiKey = settings.apiKey || "";
   const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
   if (!url || !apiKey || !model) return "";
   try { return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens, onUsage); } catch(e) { return ""; }
};

export const generateOutline = async (settings: NovelSettings, signal?: AbortSignal, onUsage?: (u: {input: number, output: number}) => void): Promise<Omit<Chapter, 'content' | 'isGenerating' | 'isDone'>[]> => {
  const languageInstruction = settings.language === 'zh' 
    ? "OUTPUT LANGUAGE: Chinese (Simplified)." 
    : "OUTPUT LANGUAGE: English.";
  
  const genreInstructions = getGenreSpecificInstructions(settings.genre);
  const genreString = settings.genre.join(' + ');
  const isOneShot = settings.novelType === 'short' || settings.chapterCount === 1;

  const formatInstruction = isOneShot
    ? `Format: Short Story (${settings.targetWordCount} words). Single chapter structure.`
    : `Format: Long Novel Series (${settings.chapterCount} chapters).`;

  const structureInstruction = isOneShot
    ? `IMPORTANT: Generate exactly ONE chapter with ID 1.`
    : `Generate ${settings.chapterCount} chapters.`;

  const worldSettingContext = settings.worldSetting 
    ? `WORLD SETTING: ${settings.worldSetting}`
    : `WORLD SETTING: Create consistent setting for ${genreString}.`;

  const charContext = settings.mainCharacters 
    ? `CHARACTERS (Initial Ideas): ${settings.mainCharacters}`
    : `CHARACTERS: To be developed.`;

  const promptText = `
    Create a chapter outline for "${settings.title}".
    Genres: ${genreString}
    ${languageInstruction}
    Premise: ${settings.premise}.
    ${formatInstruction}
    ${genreInstructions}
    ${worldSettingContext}
    ${charContext}
    IMPORTANT - STRUCTURE: ${structureInstruction}
    For each chapter, provide 'id', 'title', and 'summary'.
  `;
  const systemInstruction = getSystemInstruction("You are an expert novelist.", settings);

  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-flash-preview";
      const responseSchema: Schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.INTEGER },
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
          },
          required: ["id", "title", "summary"],
        },
      };

      const config: any = {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        systemInstruction: systemInstruction,
      };
      if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;

      const response = await wrapWithSignal(
          withRetry(() => ai.models.generateContent({
            model: model,
            contents: promptText,
            config,
        })),
        signal
      );

      if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
      }

      const jsonText = response.text || "[]";
      let result = cleanAndParseJson(jsonText);
      if (isOneShot && Array.isArray(result)) {
        if (result.length > 1) {
            const combined = result.map((c: any) => c.summary).join(' -> ');
            result = [{ id: 1, title: settings.title, summary: combined }];
        } else if (result.length === 1) { result[0].id = 1; }
        else if (result.length === 0) { result = [{ id: 1, title: settings.title, summary: settings.premise }]; }
      }
      return result;
  }

  const jsonPrompt = `${promptText}\nIMPORTANT: Return valid JSON ONLY. Format: [{"id": 1, "title": "...", "summary": "..."}, ...]`;
  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  if (!url || !apiKey || !model) throw new Error("Missing config");

  const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: jsonPrompt}], systemInstruction, signal, settings.maxOutputTokens, onUsage);
  let result = cleanAndParseJson(text);
  if (isOneShot && Array.isArray(result)) {
        if (result.length > 1) {
            const combined = result.map((c: any) => c.summary).join(' -> ');
            result = [{ id: 1, title: settings.title, summary: combined }];
        } else if (result.length === 1) { result[0].id = 1; }
        else if (result.length === 0) { result = [{ id: 1, title: settings.title, summary: settings.premise }]; }
  }
  return result;
};

export const generateCharacters = async (settings: NovelSettings, signal?: AbortSignal, onUsage?: (u: {input: number, output: number}) => void): Promise<Character[]> => {
  const languageInstruction = settings.language === 'zh' ? "OUTPUT LANGUAGE: Chinese (Simplified)." : "OUTPUT LANGUAGE: English.";
  const genreInstructions = getGenreSpecificInstructions(settings.genre);
  const worldSettingContext = settings.worldSetting ? `WORLD SETTING: ${settings.worldSetting}` : ``;
  
  const charContext = settings.mainCharacters 
    ? `USER PROVIDED CHARACTERS (MUST INCLUDE/REFINE THESE): ${settings.mainCharacters}`
    : ``;

  const promptText = `
    Create 3-6 main characters for "${settings.title}".
    Genres: ${settings.genre.join(', ')}
    Premise: ${settings.premise}
    ${languageInstruction}
    ${genreInstructions}
    ${worldSettingContext}
    ${charContext}
    Provide: name, role, description, relationships.
  `;
  const systemInstruction = getSystemInstruction("You are a character designer.", settings);

  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-flash-preview";
      const responseSchema: Schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            role: { type: Type.STRING },
            description: { type: Type.STRING },
            relationships: { type: Type.STRING },
          },
          required: ["name", "role", "description", "relationships"],
        },
      };

      const config: any = {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            systemInstruction: systemInstruction,
      };
      if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;

      const response = await wrapWithSignal(
          withRetry(() => ai.models.generateContent({
            model: model,
            contents: promptText,
            config,
        })),
        signal
      );
      if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
      }
      return cleanAndParseJson(response.text || "[]");
  }

  const jsonPrompt = `${promptText}\nIMPORTANT: Return valid JSON ONLY. Format: [{"name": "...", "role": "...", "description": "...", "relationships": "..."}, ...]`;
  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  if (!url || !apiKey || !model) throw new Error("Missing config");

  const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: jsonPrompt}], systemInstruction, signal, settings.maxOutputTokens, onUsage);
  return cleanAndParseJson(text);
};

export const checkConsistency = async (content: string, characters: Character[], settings: NovelSettings, onUsage?: (u: {input: number, output: number}) => void): Promise<string> => {
    const charProfiles = characters.map(c => `${c.name} (${c.role}): ${c.description}. Relationships: ${c.relationships}`).join('\n');
    const promptText = `Analyze consistency.\nProfiles:\n${charProfiles}\nContent:\n${content.slice(0, 15000)}`;
    const systemInstruction = getSystemInstruction("You are a continuity editor.", settings);
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config }));
        if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
        }
        return response.text || "Consistent";
    }
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    if (!url || !apiKey || !model) return "Skipped";
    try { return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens, onUsage); } catch(e) { return "Skipped"; }
};

export const fixChapterConsistency = async (content: string, characters: Character[], analysis: string, settings: NovelSettings, onUsage?: (u: {input: number, output: number}) => void): Promise<string> => {
    const charProfiles = characters.map(c => `${c.name}: ${c.description}`).join('\n');
    const promptText = `Rewrite to fix consistency.\nIssues:${analysis}\nProfiles:${charProfiles}\nContent:${content}`;
    const systemInstruction = getSystemInstruction("Expert editor.", settings);
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-pro-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config }));
        if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
        }
        return response.text || content;
    }
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    if (!url || !apiKey || !model) throw new Error("Missing config");
    return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens, onUsage);
};

export const checkGrammar = async (text: string, settings: NovelSettings, onUsage?: (u: {input: number, output: number}) => void): Promise<GrammarIssue[]> => {
    const promptText = `Identify grammar issues in ${settings.language === 'zh' ? 'Chinese' : 'English'}.\nText:${text.slice(0, 5000)}`;
    const systemInstruction = getSystemInstruction("Proofreader.", settings);
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const responseSchema: Schema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { original: { type: Type.STRING }, suggestion: { type: Type.STRING }, explanation: { type: Type.STRING } } } };
        const config: any = { responseMimeType: "application/json", responseSchema, systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config }));
        if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
        }
        return cleanAndParseJson(response.text || "[]");
    }
    const jsonPrompt = `${promptText}\nFormat: JSON Array.`;
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    if (!url || !apiKey || !model) return [];
    try { const t = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: jsonPrompt}], systemInstruction, undefined, settings.maxOutputTokens, onUsage); return cleanAndParseJson(t); } catch(e) { return []; }
};

export const autoCorrectGrammar = async (text: string, settings: NovelSettings, onUsage?: (u: {input: number, output: number}) => void): Promise<string> => {
    const promptText = `Correct grammar in ${settings.language === 'zh' ? 'Chinese' : 'English'}.\nText:${text}`;
    const systemInstruction = getSystemInstruction("Proofreader.", settings);
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config }));
        if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
        }
        return response.text || text;
    }
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    if (!url || !apiKey || !model) throw new Error("Missing config");
    return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens, onUsage);
};

export const continueWriting = async function* (currentContent: string, settings: NovelSettings, chapterTitle: string, characters: Character[] = [], onUsage?: (u: {input: number, output: number}) => void) {
    let charContext = "";
    if (characters && characters.length > 0) {
        charContext = "### CHARACTERS ###\n" + characters.map(c => `- ${c.name} (${c.role}): ${c.description}. Relations: ${c.relationships}`).join("\n");
    }

    const promptText = `Continue writing. Title: ${settings.title}. Chapter: ${chapterTitle}. \n${charContext}\nContext: ${currentContent.slice(-8000)}`;
    const systemInstruction = getSystemInstruction("Co-author.", settings);
    
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const stream = await withRetry(() => ai.models.generateContentStream({ model, contents: promptText, config }));
        
        for await (const chunk of stream) { 
             if (chunk.usageMetadata && onUsage) {
                 onUsage({
                    input: chunk.usageMetadata.promptTokenCount || 0,
                    output: chunk.usageMetadata.candidatesTokenCount || 0
                 });
             }
             if (chunk.text) yield chunk.text; 
        }
        return;
    }
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    if (!url || !apiKey || !model) throw new Error("Missing config");
    const stream = streamOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens, onUsage);
    for await (const text of stream) { yield text; }
};

export const generateChapterStream = async function* (settings: NovelSettings, chapter: Chapter, storySummaries: string = "", lastChapterEnding: string = "", characters: Character[] = [], onUsage?: (u: {input: number, output: number}) => void) {
    const languageInstruction = settings.language === 'zh' ? "IMPORTANT: Write in Chinese (Simplified)." : "IMPORTANT: Write in English.";
    const styleInstructions = getStyleInstructions(settings);
    const genreInstructions = getGenreSpecificInstructions(settings.genre);
    const isOneShot = settings.novelType === 'short' || settings.chapterCount === 1;
    let task = `Write Chapter ${chapter.id}: "${chapter.title}".`;
    if (isOneShot) task = `Write COMPLETE short story "${settings.title}". Chapter: "${chapter.title}".`;

    let context = "";
    if (storySummaries) context += `### SUMMARIES ###\n${storySummaries}\n\n`;
    if (lastChapterEnding) context += `### PREVIOUS SCENE ###\n${lastChapterEnding}\n\n`;
    
    if (characters && characters.length > 0) {
        context += `### CHARACTERS ###\n` + characters.map(c => `- ${c.name} (${c.role}): ${c.description}. Relations: ${c.relationships}`).join("\n") + "\n\n";
    }

    const promptText = `${task}\n${languageInstruction}\nChapter Plan: ${chapter.summary}\nPremise: ${settings.premise}\n${context}\n${styleInstructions}\n${genreInstructions}\n\nCRITICAL: Seamless transition. No repetition. Show don't tell.`;
    const systemInstruction = getSystemInstruction("Best-selling author.", settings);

    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-pro-preview";
        const config: any = { systemInstruction };
        if (!settings.modelName) config.thinkingConfig = { thinkingBudget: 2048 };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;

        const stream = await withRetry(() => ai.models.generateContentStream({ model, contents: promptText, config }));
        
        for await (const chunk of stream) { 
            if (chunk.usageMetadata && onUsage) {
                 onUsage({
                    input: chunk.usageMetadata.promptTokenCount || 0,
                    output: chunk.usageMetadata.candidatesTokenCount || 0
                 });
             }
            if (chunk.text) yield chunk.text; 
        }
        return;
    }

    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    if (!url || !apiKey || !model) throw new Error("Missing config");
    const stream = streamOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens, onUsage);
    for await (const text of stream) { yield text; }
};