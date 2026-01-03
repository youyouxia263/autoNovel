
import { GoogleGenAI, Type, Schema, GenerateContentResponse } from "@google/genai";
import { NovelSettings, Chapter, ModelProvider, Character, GrammarIssue } from "../types";
import { DEFAULT_PROMPTS, PROMPT_KEYS, fillPrompt } from "./promptTemplates";

const GEMINI_API_KEY = process.env.API_KEY || '';

// --- Universal Helpers ---

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getPromptTemplate = (key: string, settings: NovelSettings) => {
    return settings.customPrompts?.[key] || DEFAULT_PROMPTS[key] || "";
};

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
        const keys = ['summary', 'title', 'description', 'relationships', 'name', 'role', 'content', 'id', 'original', 'suggestion', 'explanation', 'volume_number', 'volume_title', 'chapters'];
        let fixed = str;
        keys.forEach(key => {
             if (key === 'id' || key === 'volume_number') return;
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

// --- Helper: Construct Genre String from Tomato Novel Settings ---
const buildGenreString = (settings: NovelSettings): string => {
    let genreStr = `主分类: ${settings.mainCategory}`;
    if (settings.themes && settings.themes.length > 0) {
        genreStr += `, 主题: ${settings.themes.join('/')}`;
    }
    if (settings.roles && settings.roles.length > 0) {
        genreStr += `, 角色: ${settings.roles.join('/')}`;
    }
    if (settings.plots && settings.plots.length > 0) {
        genreStr += `, 情节: ${settings.plots.join('/')}`;
    }
    return genreStr;
};

// --- Genre Specific Instructions (Updated for new system) ---
const getGenreSpecificInstructions = (settings: NovelSettings) => {
    // We focus on the Main Category for broad guidance
    const mainCat = settings.mainCategory;
    let instructions = "";

    // General logic mapping
    if (mainCat.includes('玄幻') || mainCat.includes('仙侠') || mainCat.includes('武侠')) {
         instructions += `\nGENRE GUIDE - EASTERN FANTASY/CULTIVATION (玄幻/仙侠/武侠):\n- **Key Elements**: Cultivation ranks, martial arts sects, immortality, ruthlessness, strength rules.\n`;
    } else if (mainCat.includes('都市') || mainCat.includes('现实') || mainCat.includes('职场')) {
         instructions += `\nGENRE GUIDE - URBAN/MODERN (都市/现实):\n- **Key Elements**: Modern cities, career success, social dynamics, realistic relationships.\n`;
    } else if (mainCat.includes('言情') || mainCat.includes('婚恋')) {
         instructions += `\nGENRE GUIDE - ROMANCE (言情):\n- **Key Elements**: Relationship development, emotional growth, intimacy, psychological tension.\n`;
    } else if (mainCat.includes('悬疑') || mainCat.includes('灵异') || mainCat.includes('惊悚')) {
         instructions += `\nGENRE GUIDE - SUSPENSE/THRILLER (悬疑/灵异):\n- **Key Elements**: High stakes, hidden truths, atmosphere of fear or mystery, unreliable narration.\n`;
    } else if (mainCat.includes('科幻') || mainCat.includes('未来世界')) {
         instructions += `\nGENRE GUIDE - SCI-FI (科幻):\n- **Key Elements**: Futuristic technology, space/time travel, AI, societal changes.\n`;
    } else if (mainCat.includes('历史') || mainCat.includes('军事')) {
         instructions += `\nGENRE GUIDE - HISTORY (历史/军事):\n- **Key Elements**: Historical accuracy or plausible alternate history, warfare, kingdom building, strategy.\n`;
    } else if (mainCat.includes('游戏')) {
         instructions += `\nGENRE GUIDE - GAMING (网游):\n- **Key Elements**: Game mechanics, levels, skills, e-sports, virtual vs reality.\n`;
    }

    // Add generic instruction to respect tags
    instructions += `\nIMPORTANT: Integrate the selected themes (${settings.themes?.join(',') || 'none'}) and plot elements (${settings.plots?.join(',') || 'none'}) naturally into the narrative. If the role is '${settings.roles?.join(',') || 'none'}', ensure the protagonist acts accordingly.`;

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
    
    const genreString = buildGenreString(settings);
    const template = getPromptTemplate(PROMPT_KEYS.EXPAND_TEXT, settings);
    
    const promptText = fillPrompt(template, {
        contextType,
        genre: genreString,
        title: settings.title,
        language: langInstruction,
        currentText
    });
    
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
        })) as GenerateContentResponse;
        
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

export const generateCharacterConcepts = async (settings: NovelSettings, onUsage?: (u: {input: number, output: number}) => void, count: number = 4): Promise<string> => {
    const language = settings.language;
    const genreString = buildGenreString(settings);
    const langInstruction = language === 'zh' ? "OUTPUT LANGUAGE: Chinese (Simplified)." : "OUTPUT LANGUAGE: English.";
    
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_CHARACTERS, settings);
    const genreInstructions = getGenreSpecificInstructions(settings);
    const worldSettingContext = settings.worldSetting ? `WORLD SETTING: ${settings.worldSetting}` : ``;
    const charContext = settings.mainCharacters 
        ? `USER PROVIDED CHARACTERS (MUST INCLUDE/REFINE THESE): ${settings.mainCharacters}`
        : ``;

    const promptText = fillPrompt(template, {
        title: settings.title,
        genre: genreString,
        premise: settings.premise,
        language: langInstruction,
        genreGuide: genreInstructions,
        world: worldSettingContext,
        characters: charContext,
        count: count.toString()
    });

    const systemInstruction = getSystemInstruction("You are a character designer.", settings);

    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config })) as GenerateContentResponse;
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
    const genreString = buildGenreString(settings);
    
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_SINGLE_CHARACTER, settings);
    const promptText = fillPrompt(template, {
        title: settings.title,
        existingNames: existingNames,
        genre: genreString,
        language: langInstruction,
        premise: settings.premise
    });

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
        
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config })) as GenerateContentResponse;
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
    const genreString = buildGenreString(settings);
    
    const langInstruction = language === 'zh' ? "OUTPUT LANGUAGE: Chinese (Simplified)." : "OUTPUT LANGUAGE: English.";
  
    let specificPrompt = "";
    if (settings.themes.includes("系统")) {
        specificPrompt = "Define the 'System': What is its name? What are the core functions? What are the penalties?";
    } else if (settings.mainCategory.includes('玄幻') || settings.mainCategory.includes('仙侠')) {
        specificPrompt = "Define the Cultivation/Magic System: Power levels (ranks), Factions/Sects, Divine Beasts?";
    } else if (settings.mainCategory.includes('游戏') || settings.themes.includes('网游')) {
        specificPrompt = "Define the Game World: VRMMO mechanics, classes, major guilds?";
    } else if (settings.themes.includes("末世")) {
        specificPrompt = "Define the Apocalypse: What caused it? Zombies/Monsters? Special abilities?";
    } else {
        specificPrompt = "Define the World Setting: Time period, location, social rules, power structure.";
    }
  
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_WORLD, settings);
    const promptText = fillPrompt(template, {
        title: settings.title,
        genre: genreString,
        language: langInstruction,
        premise: settings.premise,
        specificPrompt: specificPrompt
    });

    const systemInstruction = getSystemInstruction("You are a world-building expert.", settings);
  
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config })) as GenerateContentResponse;
        
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
    const genreString = buildGenreString(settings);
    const langInstruction = language === 'zh' ? "OUTPUT LANGUAGE: Chinese (Simplified)." : "OUTPUT LANGUAGE: English.";
    const task = currentPremise && currentPremise.trim().length > 0
      ? `Expand idea: "${currentPremise}" into a plot summary.`
      : `Create a plot summary for "${title}".`;
  
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_PREMISE, settings);
    const promptText = fillPrompt(template, {
        task,
        genre: genreString,
        language: langInstruction
    });

    const systemInstruction = getSystemInstruction("You are a creative writing assistant.", settings);
  
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config })) as GenerateContentResponse;
        
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
   const genreString = buildGenreString(settings);
   const promptText = `Task: Summarize chapter. Genres: ${genreString}. Content: ${content.slice(0, 15000)}. Length: 3-5 sentences.`;
   const systemInstruction = getSystemInstruction("You are an expert editor.", settings);
   
   if (settings.provider === 'gemini') {
       const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
       const model = settings.modelName || "gemini-3-flash-preview";
       const config: any = { systemInstruction };
       if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
       const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config })) as GenerateContentResponse;
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
  
  const genreInstructions = getGenreSpecificInstructions(settings);
  const genreString = buildGenreString(settings);
  const isOneShot = settings.novelType === 'short' || settings.chapterCount === 1;
  const isLongNovel = settings.chapterCount > 100;

  let formatInstruction = "";
  let structureInstruction = "";

  if (isOneShot) {
      formatInstruction = `Format: Short Story (${settings.targetWordCount} words). Single chapter structure.`;
      structureInstruction = `IMPORTANT: Generate exactly ONE chapter with ID 1.`;
  } else if (isLongNovel) {
      formatInstruction = `Format: Very Long Novel (${settings.chapterCount} chapters). Must be divided into VOLUMES (卷) to manage pacing and reader fatigue.`;
      structureInstruction = `
      IMPORTANT: Organize the outline into VOLUMES.
      Each volume should have a clear arc.
      Generate the volume structure for the first 3-5 volumes, detailing chapters for Volume 1.
      `;
  } else {
      formatInstruction = `Format: Novel Series (${settings.chapterCount} chapters).`;
      structureInstruction = `Generate ${settings.chapterCount} chapters.`;
  }

  const worldSettingContext = settings.worldSetting 
    ? `WORLD SETTING: ${settings.worldSetting}`
    : `WORLD SETTING: Create consistent setting for ${genreString}.`;

  const charContext = settings.mainCharacters 
    ? `CHARACTERS (Initial Ideas): ${settings.mainCharacters}`
    : `CHARACTERS: To be developed.`;

  const template = getPromptTemplate(PROMPT_KEYS.GENERATE_OUTLINE, settings);
  const promptText = fillPrompt(template, {
      title: settings.title,
      genre: genreString,
      language: languageInstruction,
      premise: settings.premise,
      format: formatInstruction,
      genreGuide: genreInstructions,
      world: worldSettingContext,
      characters: charContext,
      structure: structureInstruction
  });

  const systemInstruction = getSystemInstruction("You are an expert novelist.", settings);

  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-flash-preview";
      
      // Use different schema for long novels to enforce volume structure
      let responseSchema: Schema;
      
      if (isLongNovel) {
          responseSchema = {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                volume_number: { type: Type.INTEGER },
                volume_title: { type: Type.STRING },
                chapters: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.INTEGER },
                            title: { type: Type.STRING },
                            summary: { type: Type.STRING },
                        },
                        required: ["id", "title", "summary"]
                    }
                }
              },
              required: ["volume_number", "volume_title", "chapters"],
            },
          };
      } else {
          responseSchema = {
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
      }

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
      ) as GenerateContentResponse;

      if (response.usageMetadata && onUsage) {
            onUsage({
                input: response.usageMetadata.promptTokenCount || 0,
                output: response.usageMetadata.candidatesTokenCount || 0
            });
      }

      const jsonText = response.text || "[]";
      let result = cleanAndParseJson(jsonText);

      // Post-processing: Flatten volume structure if necessary
      if (isLongNovel && Array.isArray(result) && result.length > 0 && result[0].chapters) {
          const flatChapters: any[] = [];
          let globalIdCounter = 1;
          
          result.forEach((vol: any) => {
              if (vol.chapters && Array.isArray(vol.chapters)) {
                  vol.chapters.forEach((ch: any) => {
                      // Ensure sequential IDs across volumes if AI resets them
                      const chId = ch.id < globalIdCounter ? globalIdCounter : ch.id;
                      globalIdCounter = chId + 1;
                      
                      flatChapters.push({
                          id: chId,
                          title: ch.title,
                          summary: ch.summary,
                          volumeId: vol.volume_number,
                          volumeTitle: vol.volume_title
                      });
                  });
              }
          });
          return flatChapters;
      }

      if (isOneShot && Array.isArray(result)) {
        if (result.length > 1) {
            const combined = result.map((c: any) => c.summary).join(' -> ');
            result = [{ id: 1, title: settings.title, summary: combined }];
        } else if (result.length === 1) { result[0].id = 1; }
        else if (result.length === 0) { result = [{ id: 1, title: settings.title, summary: settings.premise }]; }
      }
      return result;
  }

  // Fallback for non-gemini providers (simplified logic for brevity, assumes standard format)
  const jsonPrompt = `${promptText}\nIMPORTANT: Return valid JSON ONLY. Format: [{"id": 1, "title": "...", "summary": "..."}, ...]`;
  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  if (!url || !apiKey || !model) throw new Error("Missing config");

  const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: jsonPrompt}], systemInstruction, signal, settings.maxOutputTokens, onUsage);
  let result = cleanAndParseJson(text);
  // ... existing one-shot logic ...
  return result;
};

// ... (rest of the file remains unchanged)
export const generateCharacters = async (settings: NovelSettings, signal?: AbortSignal, onUsage?: (u: {input: number, output: number}) => void, count: number = 4): Promise<Character[]> => {
  const languageInstruction = settings.language === 'zh' ? "OUTPUT LANGUAGE: Chinese (Simplified)." : "OUTPUT LANGUAGE: English.";
  const genreInstructions = getGenreSpecificInstructions(settings);
  const genreString = buildGenreString(settings);
  const worldSettingContext = settings.worldSetting ? `WORLD SETTING: ${settings.worldSetting}` : ``;
  
  const charContext = settings.mainCharacters 
    ? `USER PROVIDED CHARACTERS (MUST INCLUDE/REFINE THESE): ${settings.mainCharacters}`
    : ``;

  const template = getPromptTemplate(PROMPT_KEYS.GENERATE_CHARACTERS, settings);
  const promptText = fillPrompt(template, {
      title: settings.title,
      genre: genreString,
      premise: settings.premise,
      language: languageInstruction,
      genreGuide: genreInstructions,
      world: worldSettingContext,
      characters: charContext,
      count: count.toString()
  });
  
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
      ) as GenerateContentResponse;
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
    
    const template = getPromptTemplate(PROMPT_KEYS.CHECK_CONSISTENCY, settings);
    const promptText = fillPrompt(template, {
        characters: charProfiles,
        content: content.slice(0, 15000)
    });
    
    const systemInstruction = getSystemInstruction("You are a continuity editor.", settings);
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config })) as GenerateContentResponse;
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
    
    const template = getPromptTemplate(PROMPT_KEYS.FIX_CONSISTENCY, settings);
    const promptText = fillPrompt(template, {
        analysis: analysis,
        characters: charProfiles,
        content: content
    });

    const systemInstruction = getSystemInstruction("Expert editor.", settings);
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-pro-preview";
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config })) as GenerateContentResponse;
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
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config })) as GenerateContentResponse;
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
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config })) as GenerateContentResponse;
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
        
        const stream = await withRetry(() => ai.models.generateContentStream({ model, contents: promptText, config })) as AsyncIterable<GenerateContentResponse>;
        
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

export const extendChapter = async function* (
    currentContent: string, 
    settings: NovelSettings, 
    chapterTitle: string, 
    characters: Character[] = [], 
    targetWords: number = 4000,
    currentWords: number = 0,
    onUsage?: (u: {input: number, output: number}) => void
) {
    let charContext = "";
    if (characters && characters.length > 0) {
        charContext = "### CHARACTERS ###\n" + characters.map(c => `- ${c.name} (${c.role}): ${c.description}. Relations: ${c.relationships}`).join("\n");
    }

    const languageInstruction = settings.language === 'zh' ? "Write in Chinese (Simplified)." : "Write in English.";
    
    const promptText = `
${languageInstruction}
TASK: EXTEND the current chapter to meet the minimum word count requirement of ${targetWords} words. Current word count is approximately ${currentWords}.
Novel Title: ${settings.title}
Chapter Title: ${chapterTitle}

${charContext}

NARRATIVE CONTEXT (End of current text):
"...${currentContent.slice(-4000)}..."

INSTRUCTIONS:
1. Seamlessly continue the scene from the context above.
2. EXPAND on the plot points, dialogue, and sensory details.
3. Introduce complications, detailed character interactions, or internal monologues to add substance.
4. DO NOT rush to conclude the chapter. 
5. Maintain a coherent flow and compact plot (剧情紧凑).
6. Avoid repetition.
`;

    const systemInstruction = getSystemInstruction("You are a best-selling novelist skilled in writing detailed, long-form narratives.", settings);
    
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-pro-preview"; // Use Pro for better extension logic
        const config: any = { systemInstruction };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const stream = await withRetry(() => ai.models.generateContentStream({ model, contents: promptText, config })) as AsyncIterable<GenerateContentResponse>;
        
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

export const generateChapterStream = async function* (
    settings: NovelSettings, 
    chapter: Chapter, 
    storySummaries: string = "", 
    previousChapterContent: string = "", 
    characters: Character[] = [], 
    onUsage?: (u: {input: number, output: number}) => void
) {
    const languageInstruction = settings.language === 'zh' ? "IMPORTANT: Write in Chinese (Simplified)." : "IMPORTANT: Write in English.";
    const styleInstructions = getStyleInstructions(settings);
    const genreInstructions = getGenreSpecificInstructions(settings);
    const isOneShot = settings.novelType === 'short' || settings.chapterCount === 1;
    let task = `Write Chapter ${chapter.id}: "${chapter.title}".`;
    if (isOneShot) task = `Write a COMPLETE, COHERENT short story "${settings.title}" with a TIGHT plot. Chapter title: "${chapter.title}". Ensure the narrative arc is fully resolved within this text.`;

    let charContext = "";
    if (characters && characters.length > 0) {
        charContext = "### CHARACTERS ###\n" + characters.map(c => `- ${c.name} (${c.role}): ${c.description}. Relations: ${c.relationships}`).join("\n");
    }

    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_CHAPTER, settings);
    const promptText = fillPrompt(template, {
        task,
        language: languageInstruction,
        chapterId: chapter.id.toString(),
        chapterSummary: chapter.summary,
        premise: settings.premise,
        storySummaries: storySummaries || "No previous chapters.",
        previousChapterContent: previousChapterContent || "This is the first chapter.",
        characters: charContext,
        style: styleInstructions,
        genreGuide: genreInstructions,
        // Backward compatibility
        context: `Summaries:\n${storySummaries}\n\nPrevious Scene:\n${previousChapterContent}\n\nCharacters:\n${charContext}`
    });

    const systemInstruction = getSystemInstruction("Best-selling author.", settings);

    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-pro-preview";
        const config: any = { systemInstruction };
        if (!settings.modelName) config.thinkingConfig = { thinkingBudget: 2048 };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;

        const stream = await withRetry(() => ai.models.generateContentStream({ model, contents: promptText, config })) as AsyncIterable<GenerateContentResponse>;
        
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
