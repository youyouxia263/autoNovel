
import { GoogleGenAI, Type, Schema, GenerateContentResponse } from "@google/genai";
import { NovelSettings, Chapter, ModelProvider, Character, GrammarIssue } from "../types";
import { DEFAULT_PROMPTS, PROMPT_KEYS, fillPrompt } from "./promptTemplates";

const GEMINI_API_KEY = process.env.API_KEY || '';

// --- Universal Helpers ---

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getPromptTemplate = (key: string, settings: NovelSettings) => {
    return settings.customPrompts?.[key] || DEFAULT_PROMPTS[key] || "";
};

// Centralized Helper for Model/Key Resolution
const getModelConfig = (settings: NovelSettings) => {
    let model = settings.modelName || "";
    let apiKey = settings.apiKey || "";
    
    if (settings.provider === 'gemini') {
        apiKey = GEMINI_API_KEY; // Always use env var for Gemini per guidelines
        if (!model) model = "gemini-3-flash-preview"; 
    } else if (settings.provider === 'alibaba') {
        if (!model) model = "qwen-plus";
    }
    
    return { model, apiKey, provider: settings.provider };
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

// Helper to sanitize character object to ensure fields are strings
export const sanitizeCharacter = (char: any): Character => {
    const ensureString = (val: any) => {
        if (typeof val === 'string') return val;
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') {
            // Flatten object to string (e.g. relationship map)
            return Object.entries(val).map(([k, v]) => `${k}: ${v}`).join('; ');
        }
        return String(val);
    };

    return {
        name: ensureString(char.name),
        role: ensureString(char.role),
        description: ensureString(char.description),
        relationships: ensureString(char.relationships),
    };
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
            // Don't retry safety blocks or bad request (400/404) unless it's a specific known transient issue
            const isSafetyBlock = msg.includes('data_inspection_failed') || msg.includes('inappropriate content');
            const isAuthError = msg.includes('401') || msg.includes('Unauthorized');
            const isNotFound = msg.includes('404') || msg.includes('not exist');

            if (isAborted || isSafetyBlock || isAuthError || isNotFound) throw error; 
            
            if (isRateLimit) {
                // If it is the LAST retry, we shouldn't wait, just loop to fail
                if (i === retries - 1) break;

                // Aggressive backoff for rate limits: 10s, 20s, 40s... to allow quota to reset
                // Cap at 60s wait per try to avoid hanging forever
                const rawDelay = 10000 * Math.pow(2, i); 
                const delay = Math.min(rawDelay, 60000); 

                console.warn(`API Rate Limit (${msg}). Retrying in ${delay/1000}s...`);
                await wait(delay);
                continue;
            }

            if ((isServer || isNetwork) && i < retries - 1) {
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
        const keys = ['summary', 'title', 'description', 'relationships', 'name', 'role', 'content', 'id', 'original', 'suggestion', 'explanation', 'volume_number', 'volume_title', 'chapters', 'volumeId', 'volumeTitle'];
        let fixed = str;
        keys.forEach(key => {
             if (key === 'id' || key === 'volume_number' || key === 'volumeId') return;
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

    // Last ditch: try to find array brackets
    const firstBracket = clean.indexOf('[');
    const lastBracket = clean.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        const arrayStr = clean.substring(firstBracket, lastBracket + 1);
        result = tryParse(arrayStr);
        if (result) return result;
        result = tryParse(fixUnquoted(arrayStr));
        if (result) return result;
    }
    
    console.error("JSON Parse Failed. Raw:", text);
    throw new Error(`JSON Parse Error: Could not parse or repair output. Raw: ${text.slice(0, 50)}...`);
}

// --- OpenAI-Compatible Stream Parser Helper ---
async function* streamOpenAICompatible(
    url: string, 
    apiKey: string, 
    model: string, 
    messages: any[], 
    systemInstruction?: string, 
    temperature: number = 0.7, 
    maxTokens?: number, 
    signal?: AbortSignal,
    onUsage?: (u: {input: number, output: number}) => void
): AsyncGenerator<string, void, unknown> {
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
    stream_options: { include_usage: true }, 
    temperature: temperature
  };

  if (maxTokens) body.max_tokens = maxTokens;

  let response: Response | null = null;
  
  // Retry loop for stream init
  for(let i=0; i<5; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
        if (!response.ok) {
             const errorText = await response.text();
             let errorMsg = errorText;
             try {
                const jsonErr = JSON.parse(errorText);
                errorMsg = jsonErr.error?.message || jsonErr.message || errorText;
             } catch(e) {}
             
             if (response.status === 401) throw new Error(`API Error: 401 Unauthorized. Please check your API Key.`);
             
             // Handle 429 explicitly in stream
             if (response.status === 429 || errorMsg.includes('quota') || errorMsg.includes('429')) {
                 if (i === 4) throw new Error(`Provider API Rate Limit: ${response.status} ${errorMsg}`);
                 const delay = 5000 * Math.pow(2, i);
                 console.warn(`Stream Rate Limit. Retrying in ${delay}ms...`);
                 await wait(delay);
                 continue;
             }
             
             // Handle 404 (Model not found)
             if (response.status === 404) {
                 throw new Error(`API Error: 404 Model '${model}' not found. Please check Model Name settings.`);
             }

             if (response.status >= 500) {
                 if (i === 4) throw new Error(`Provider Server Error: ${response.status}`);
                 await wait(2000 * Math.pow(2, i));
                 continue;
             }
             
             // Check for Aliyun content safety error or similar 400s that shouldn't be retried
             if (response.status === 400 && (errorMsg.includes('inappropriate content') || errorMsg.includes('data_inspection_failed'))) {
                 throw new Error(`Content Safety Error: ${errorMsg}`);
             }

             throw new Error(`Provider API Error: ${response.status} ${errorMsg}`);
        }
        break; 
      } catch (e: any) {
          const msg = e.message || '';
          if (msg.includes("401") || msg.includes("404") || msg.includes("Content Safety")) throw e;
          if (e.name === 'AbortError') throw e;
          // Retry on network errors or rate limit errors caught as exceptions
          if (i === 4) throw e;
          const delay = msg.includes("Rate Limit") ? 5000 * Math.pow(2, i) : 2000 * Math.pow(2, i);
          await wait(delay);
      }
  }

  if (!response || !response.body) throw new Error("Failed to get response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
      while (true) {
        if (signal?.aborted) {
            reader.cancel();
            throw new DOMException('Aborted', 'AbortError');
        }
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
            if (json.usage && onUsage) {
                onUsage({ input: json.usage.prompt_tokens || 0, output: json.usage.completion_tokens || 0 });
            }
            const content = json.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch (e) {}
        }
      }
  } catch (e) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw e;
  }
}

async function fetchOpenAICompatible(url: string, apiKey: string, model: string, messages: any[], systemInstruction?: string, signal?: AbortSignal, maxTokens?: number, onUsage?: (u: {input: number, output: number}) => void) {
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    const body: any = {
        model: model,
        messages: [ ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []), ...messages ],
        stream: false
    };
    if (maxTokens) body.max_tokens = maxTokens;

    return await withRetry(async () => {
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
        if(!response.ok) {
            const txt = await response.text();
            let msg = txt;
            try { const json = JSON.parse(txt); msg = json.error?.message || json.message || txt; } catch (e) {}
            if (response.status === 401) throw new Error(`API Error: 401 Unauthorized. Incorrect API key provided.`);
            if (response.status === 404) throw new Error(`API Error: 404 The model '${model}' does not exist or you do not have access to it.`);
            
            if (response.status === 429) {
                 throw new Error(`429 RESOURCE_EXHAUSTED: ${msg}`); // Trigger withRetry logic
            }
            if (response.status === 400 && (msg.includes('inappropriate content') || msg.includes('data_inspection_failed'))) {
                 throw new Error(`Content Safety Error: ${msg}`);
            }
            throw new Error(`API Error: ${response.status} ${msg}`);
        }
        const json = await response.json();
        if (json.usage && onUsage) onUsage({ input: json.usage.prompt_tokens || 0, output: json.usage.completion_tokens || 0 });
        return json.choices?.[0]?.message?.content || "";
    }, 5); // Increased retries for compatible endpoints
}

// ... (rest of helper functions unchanged until generateChapterStream)
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

// --- Genre Specific Instructions ---
const getGenreSpecificInstructions = (settings: NovelSettings) => {
    const mainCat = settings.mainCategory;
    let instructions = "";
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

// ... (rest of generateOutline unchanged)

export const generateOutline = async (settings: NovelSettings, signal?: AbortSignal, onUsage?: (u: {input: number, output: number}) => void): Promise<Omit<Chapter, 'content' | 'isGenerating' | 'isDone'>[]> => {
  const { model, apiKey, provider } = getModelConfig(settings);
  const languageInstruction = settings.language === 'zh' ? "OUTPUT LANGUAGE: Chinese (Simplified)." : "OUTPUT LANGUAGE: English.";
  const genreInstructions = getGenreSpecificInstructions(settings);
  const genreString = buildGenreString(settings);
  const isOneShot = settings.novelType === 'short' || settings.chapterCount === 1;
  const isLongNovel = settings.novelType === 'long';
  const targetCount = settings.chapterCount || (isLongNovel ? 20 : 10);

  const worldSettingContext = settings.worldSetting ? `WORLD SETTING: ${settings.worldSetting}` : ``;
  const charContext = settings.mainCharacters ? `CHARACTERS: ${settings.mainCharacters}` : ``;

  const template = getPromptTemplate(PROMPT_KEYS.GENERATE_OUTLINE, settings);
  const systemInstruction = getSystemInstruction("You are an expert novelist planning a story.", settings);

  // Volume Structure Logic
  const VOLUME_THRESHOLD = 120;
  let volumePlanStr = "";
  
  const volumeMap: { start: number, end: number, id: number }[] = [];
  
  if (targetCount > VOLUME_THRESHOLD) {
      const optimalVolSize = 100;
      const numVolumes = Math.ceil(targetCount / optimalVolSize);
      const volSize = Math.ceil(targetCount / numVolumes);
      
      let start = 1;
      for (let i = 1; i <= numVolumes; i++) {
          const end = Math.min(start + volSize - 1, targetCount);
          volumeMap.push({ start, end, id: i });
          volumePlanStr += `Volume ${i}: Chapters ${start}-${end}. `;
          start = end + 1;
      }
      volumePlanStr += "\nEnsure continuity between volumes.";
  } else {
      volumeMap.push({ start: 1, end: targetCount, id: 1 });
      volumePlanStr = "Single Volume (Volume 1).";
  }

  const BATCH_SIZE = 10; 
  let allChapters: Omit<Chapter, 'content' | 'isGenerating' | 'isDone'>[] = [];
  let currentStartId = 1;

  while (currentStartId <= targetCount) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const currentEndId = Math.min(currentStartId + BATCH_SIZE - 1, targetCount);
      const isLastBatch = currentEndId === targetCount;
      
      const currentVolInfo = volumeMap.find(v => currentStartId >= v.start && currentStartId <= v.end) || volumeMap[0];
      const isVolStart = currentStartId === currentVolInfo.start;
      
      let paginationContext = "";
      if (allChapters.length > 0) {
          const lastChapter = allChapters[allChapters.length - 1];
          paginationContext = `
          PREVIOUS CONTEXT: The story has progressed up to Chapter ${lastChapter.id} ("${lastChapter.title}").
          LAST EVENTS: ${lastChapter.summary}
          CURRENT VOLUME: Volume ${currentVolInfo.id}.
          `;
          
          if (isVolStart && currentVolInfo.id > 1) {
              paginationContext += `\nNOTICE: This batch starts NEW VOLUME (Volume ${currentVolInfo.id}). Ensure a logical transition from the previous volume's ending.`;
          } else {
              const existingVolTitle = allChapters.find(c => c.volumeId === currentVolInfo.id)?.volumeTitle;
              if (existingVolTitle) {
                  paginationContext += `\nCONTINUING VOLUME: "${existingVolTitle}". Keep using this volume title.`;
              }
          }
      } else {
          paginationContext = `
          STARTING POINT: Begin the story from Chapter 1.
          CURRENT VOLUME: Volume 1.
          `;
      }

      const structureInstruction = `
      STRICT REQUIREMENT: Generate exactly ${currentEndId - currentStartId + 1} chapters (ID ${currentStartId} to ${currentEndId}).
      Return a FLAT JSON Array. Each object must have: 'id', 'title', 'summary', 'volumeId' (number), 'volumeTitle' (string).
      Example: [{"id": ${currentStartId}, "title": "...", "summary": "...", "volumeId": ${currentVolInfo.id}, "volumeTitle": "..."}]
      
      VOLUME PLAN: ${volumePlanStr}
      
      - Assign 'volumeId' strictly as ${currentVolInfo.id} for this batch.
      - If this is the start of a volume, generate a fitting 'volumeTitle'.
      - If continuing a volume, reuse the existing volume title if appropriate.
      - Ensure sequential IDs. Do not skip numbers.
      ${isLastBatch ? "This is the final batch. Conclude the story arc or prepare for the ending." : "Keep the plot moving forward."}
      `;

      const promptText = fillPrompt(template, {
          title: settings.title,
          genre: genreString,
          language: languageInstruction,
          premise: settings.premise,
          format: `Format: Long Novel. Total planned: ${targetCount} chapters.`,
          genreGuide: genreInstructions,
          world: worldSettingContext,
          characters: charContext,
          paginationContext: paginationContext,
          structure: structureInstruction
      });

      let batchResult: any[] = [];
      
      if (provider === 'gemini') {
          const ai = new GoogleGenAI({ apiKey });
          const responseSchema: Schema = {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                volumeId: { type: Type.INTEGER },
                volumeTitle: { type: Type.STRING },
              },
              required: ["id", "title", "summary"],
            },
          };
          const config: any = { responseMimeType: "application/json", responseSchema, systemInstruction };
          if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;

          const response = await wrapWithSignal(
              withRetry(() => ai.models.generateContent({ model, contents: promptText, config }), 5), // Increased retries for heavy tasks
              signal
          ) as GenerateContentResponse;

          if (response.usageMetadata && onUsage) {
              onUsage({ input: response.usageMetadata.promptTokenCount || 0, output: response.usageMetadata.candidatesTokenCount || 0 });
          }
          batchResult = cleanAndParseJson((response as any).text || "[]");

      } else {
          const url = getBaseUrl(settings);
          if (!url || !apiKey || !model) throw new Error("Configuration Error: API Key/Model/URL missing.");
          
          const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, signal, settings.maxOutputTokens, onUsage);
          batchResult = cleanAndParseJson(text);
      }

      if (!Array.isArray(batchResult)) {
          if (batchResult && typeof batchResult === 'object') {
              if ((batchResult as any).chapters) batchResult = (batchResult as any).chapters;
              else if ((batchResult as any).items) batchResult = (batchResult as any).items;
              else batchResult = [batchResult]; 
          } else {
              batchResult = [];
          }
      }

      let localId = currentStartId;
      for (const item of batchResult) {
          if (!item.title || !item.summary) continue;
          item.id = localId; 
          const correctVol = volumeMap.find(v => item.id >= v.start && item.id <= v.end) || volumeMap[0];
          item.volumeId = correctVol.id;
          if (!item.volumeTitle) {
              const prevInVol = allChapters.find(c => c.volumeId === correctVol.id);
              item.volumeTitle = prevInVol?.volumeTitle || `Volume ${correctVol.id}`;
          }

          allChapters.push(item);
          localId++;
      }

      if (batchResult.length === 0) {
          console.warn("Batch generation returned empty. Stopping early.");
          break; 
      }

      currentStartId += BATCH_SIZE; 
      if (currentStartId <= targetCount) await wait(5000); 
  }

  return allChapters;
};

// ... (New Service Functions section)

const runSimpleGeneration = async (promptText: string, settings: NovelSettings, systemInstruction: string = "You are a helpful assistant.", useJson = false) => {
    const { model, apiKey, provider } = getModelConfig(settings);
    let result = "";
    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const config: any = { systemInstruction };
        if (useJson) config.responseMimeType = "application/json";
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const response = await withRetry(() => ai.models.generateContent({ model, contents: promptText, config }));
        result = (response as any).text || "";
    } else {
        const url = getBaseUrl(settings);
        result = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction, undefined, settings.maxOutputTokens);
    }
    return result;
};

export const generateTitles = async (settings: NovelSettings): Promise<string[]> => {
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_TITLES, settings);
    const prompt = fillPrompt(template, {
        genre: buildGenreString(settings),
        premise: settings.premise || "Untitled Story",
        language: settings.language === 'zh' ? "Output: Chinese" : "Output: English",
    });

    const { model, apiKey, provider } = getModelConfig(settings);
    
    let resultText = "";
    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const responseSchema: Schema = {
            type: Type.ARRAY,
            items: { type: Type.STRING }
        };
        const config: any = { responseMimeType: "application/json", responseSchema };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        const response = await withRetry(() => ai.models.generateContent({ model, contents: prompt, config }));
        resultText = (response as any).text || "[]";
    } else {
        const url = getBaseUrl(settings);
        resultText = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: prompt + "\nOutput JSON Array of strings."}], undefined, undefined, settings.maxOutputTokens);
    }
    
    const parsed = cleanAndParseJson(resultText);
    return Array.isArray(parsed) ? parsed : [];
};

export const generatePremise = async (title: string, currentPremise: string, settings: NovelSettings): Promise<string> => {
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_PREMISE, settings);
    const prompt = fillPrompt(template, {
        task: "Create a compelling novel premise based on the title and any existing ideas.",
        title: title || "Untitled",
        genre: buildGenreString(settings),
        language: settings.language === 'zh' ? "Chinese" : "English",
        premise: currentPremise || "None"
    });
    return runSimpleGeneration(prompt, settings);
};

export const generateWorldSetting = async (settings: NovelSettings): Promise<string> => {
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_WORLD, settings);
    const prompt = fillPrompt(template, {
        title: settings.title || "Untitled",
        genre: buildGenreString(settings),
        language: settings.language === 'zh' ? "Chinese" : "English",
        premise: settings.premise || "None",
        specificPrompt: "Include details about magic/technology, geography, and society."
    });
    return runSimpleGeneration(prompt, settings);
};

export const expandText = async (text: string, contextType: string, settings: NovelSettings): Promise<string> => {
    const template = getPromptTemplate(PROMPT_KEYS.EXPAND_TEXT, settings);
    const prompt = fillPrompt(template, {
        contextType,
        title: settings.title || "Untitled",
        genre: buildGenreString(settings),
        language: settings.language === 'zh' ? "Chinese" : "English",
        currentText: text
    });
    return runSimpleGeneration(prompt, settings);
};

export const generateCharacterConcepts = async (settings: NovelSettings): Promise<string> => {
    // This is for the text area generation, return string
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_CHARACTERS, settings);
    const prompt = fillPrompt(template, {
        title: settings.title || "Untitled",
        genre: buildGenreString(settings),
        premise: settings.premise || "None",
        language: settings.language === 'zh' ? "Chinese" : "English",
        genreGuide: getGenreSpecificInstructions(settings),
        world: settings.worldSetting || "",
        characters: "None",
        count: "3-5"
    });
    return runSimpleGeneration(prompt, settings);
};

export const generateCharacters = async (settings: NovelSettings, signal?: AbortSignal, onUsage?: any): Promise<Character[]> => {
    const { model, apiKey, provider } = getModelConfig(settings);
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_CHARACTERS, settings);
    const prompt = fillPrompt(template, {
        title: settings.title || "Untitled",
        genre: buildGenreString(settings),
        premise: settings.premise || "None",
        language: settings.language === 'zh' ? "Chinese" : "English",
        genreGuide: getGenreSpecificInstructions(settings),
        world: settings.worldSetting || "",
        characters: settings.mainCharacters || "Generate new based on premise",
        count: "4"
    });
    
    // Strict JSON generation
    let resultText = "";
    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
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
                required: ["name", "role", "description"],
            }
        };
        const config: any = { responseMimeType: "application/json", responseSchema };
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const response = await wrapWithSignal(
             withRetry(() => ai.models.generateContent({ model, contents: prompt, config })),
             signal
        ) as GenerateContentResponse;

        if (response.usageMetadata && onUsage) {
            onUsage({ input: response.usageMetadata.promptTokenCount || 0, output: response.usageMetadata.candidatesTokenCount || 0 });
        }
        resultText = (response as any).text || "[]";
    } else {
        const url = getBaseUrl(settings);
        resultText = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: prompt + "\nOutput JSON Array."}], undefined, signal, settings.maxOutputTokens, onUsage);
    }
    
    const parsed = cleanAndParseJson(resultText);
    const charArray = Array.isArray(parsed) ? parsed : [];
    
    return charArray.map(sanitizeCharacter);
};

export const generateSingleCharacter = async (settings: NovelSettings, existingCharacters: Character[]): Promise<Character> => {
    const { model, apiKey, provider } = getModelConfig(settings);
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_SINGLE_CHARACTER, settings);
    const prompt = fillPrompt(template, {
        title: settings.title || "Untitled",
        genre: buildGenreString(settings),
        premise: settings.premise || "None",
        language: settings.language === 'zh' ? "Chinese" : "English",
        existingNames: existingCharacters.map(c => c.name).join(", ")
    });

    let resultText = "";
    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const responseSchema: Schema = {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING },
                role: { type: Type.STRING },
                description: { type: Type.STRING },
                relationships: { type: Type.STRING },
            },
            required: ["name", "role", "description"],
        };
        const config: any = { responseMimeType: "application/json", responseSchema };
        const response = await withRetry(() => ai.models.generateContent({ model, contents: prompt, config }));
        resultText = (response as any).text || "{}";
    } else {
        const url = getBaseUrl(settings);
        resultText = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: prompt + "\nOutput JSON Object."}], undefined, undefined, settings.maxOutputTokens);
    }
    const parsed = cleanAndParseJson(resultText);
    return sanitizeCharacter(parsed);
};

export async function* continueWriting(content: string, settings: NovelSettings, chapterTitle: string, characters: Character[]): AsyncGenerator<string, void, unknown> {
    const { model, apiKey, provider } = getModelConfig(settings);
    const charStr = characters.map(c => `${c.name}: ${c.description}`).join('\n');
    const prompt = `Continue writing this chapter.
    Title: ${chapterTitle}
    Genre: ${buildGenreString(settings)}
    ${settings.language === 'zh' ? 'Output Chinese.' : 'Output English.'}
    
    Style: ${getStyleInstructions(settings)}
    
    CHARACTERS IN SCENE (Reference only if relevant):
    ${charStr}

    Current Content:
    "${content.slice(-2500)}"
    
    Continue the story naturally from here. Do not repeat the last sentence.`;

    if (provider === 'gemini') {
         const ai = new GoogleGenAI({ apiKey });
         const stream = await ai.models.generateContentStream({ model, contents: prompt, config: { maxOutputTokens: settings.maxOutputTokens } });
         for await (const chunk of stream) {
             const c = chunk as GenerateContentResponse;
             if ((c as any).text) yield (c as any).text;
         }
    } else {
         const url = getBaseUrl(settings);
         const stream = streamOpenAICompatible(url, apiKey, model, [{role: 'user', content: prompt}], undefined, 0.7, settings.maxOutputTokens);
         for await (const chunk of stream) {
             yield chunk;
         }
    }
}

export const checkGrammar = async (content: string, settings: NovelSettings): Promise<GrammarIssue[]> => {
    const { model, apiKey, provider } = getModelConfig(settings);
    const prompt = `Check grammar and spelling.
    Content:
    "${content.slice(0, 4000)}"
    
    Output JSON Array of objects: { original: string, suggestion: string, explanation: string }`;

    let resultText = "";
    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const responseSchema: Schema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    original: { type: Type.STRING },
                    suggestion: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                },
                required: ["original", "suggestion"],
            }
        };
        const config: any = { responseMimeType: "application/json", responseSchema };
        const response = await withRetry(() => ai.models.generateContent({ model, contents: prompt, config }));
        resultText = (response as any).text || "[]";
    } else {
        const url = getBaseUrl(settings);
        resultText = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: prompt}], undefined, undefined, settings.maxOutputTokens);
    }
    const parsed = cleanAndParseJson(resultText);
    return Array.isArray(parsed) ? parsed : [];
};

export const autoCorrectGrammar = async (content: string, settings: NovelSettings): Promise<string> => {
    const prompt = `Correct grammar and spelling. Output ONLY the corrected text.
    Content:
    "${content}"`;
    return runSimpleGeneration(prompt, settings);
};

export async function* generateChapterStream(settings: NovelSettings, chapter: Chapter, storySummaries: string, previousContent: string, characters: Character[], signal?: AbortSignal, onUsage?: any): AsyncGenerator<string, void, unknown> {
    const { model, apiKey, provider } = getModelConfig(settings);
    const template = getPromptTemplate(PROMPT_KEYS.GENERATE_CHAPTER, settings);
    const charStr = characters.map(c => `${c.name} (${c.role}): ${c.description}`).join('\n');
    
    const prompt = fillPrompt(template, {
        task: "Write a chapter for the novel.",
        language: settings.language === 'zh' ? "Output: Chinese" : "Output: English",
        premise: settings.premise,
        storySummaries: storySummaries || "No previous chapters.",
        previousChapterContent: previousContent || "Start of story.",
        chapterSummary: `Chapter ${chapter.id} Title: ${chapter.title}\nSummary: ${chapter.summary}`,
        characters: charStr,
        style: getStyleInstructions(settings),
        genreGuide: getGenreSpecificInstructions(settings),
        chapterId: chapter.id.toString()
    });

    const systemInstruction = getSystemInstruction("You are a professional novelist.", settings);

    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        // Gemini SDK doesn't support signal directly in generateContentStream yet as cleanly as fetch, but we can wrap iterator
        const stream = await ai.models.generateContentStream({ 
            model, 
            contents: prompt, 
            config: { 
                systemInstruction, 
                maxOutputTokens: settings.maxOutputTokens 
            } 
        });
        
        for await (const chunk of stream) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const c = chunk as GenerateContentResponse;
            if (c.usageMetadata && onUsage) {
                onUsage({ input: 0, output: c.usageMetadata.candidatesTokenCount || 0 });
            }
            if ((c as any).text) yield (c as any).text;
        }
    } else {
        const url = getBaseUrl(settings);
        const stream = streamOpenAICompatible(url, apiKey, model, [{role: 'user', content: prompt}], systemInstruction, 0.7, settings.maxOutputTokens, signal, onUsage);
        for await (const chunk of stream) {
            yield chunk;
        }
    }
}

export async function* extendChapter(currentContent: string, settings: NovelSettings, chapterTitle: string, characters: Character[], targetWordCount: number, currentWordCount: number, signal?: AbortSignal, onUsage?: any): AsyncGenerator<string, void, unknown> {
    const { model, apiKey, provider } = getModelConfig(settings);
    const prompt = `The chapter "${chapterTitle}" is currently ${currentWordCount} words long, but needs to be at least ${targetWordCount} words.
    
    Current Content ending:
    "${currentContent.slice(-2000)}"
    
    Task: Continue the scene naturally to add more depth, dialogue, and detail. Do not rush to finish.
    ${settings.language === 'zh' ? "Output: Chinese" : "Output: English"}
    `;

    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const stream = await ai.models.generateContentStream({ model, contents: prompt, config: { maxOutputTokens: settings.maxOutputTokens } });
        for await (const chunk of stream) {
             if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
             const c = chunk as GenerateContentResponse;
             if (c.usageMetadata && onUsage) onUsage({ input: 0, output: c.usageMetadata.candidatesTokenCount || 0 });
             if ((c as any).text) yield (c as any).text;
        }
    } else {
        const url = getBaseUrl(settings);
        const stream = streamOpenAICompatible(url, apiKey, model, [{role: 'user', content: prompt}], undefined, 0.7, settings.maxOutputTokens, signal, onUsage);
        for await (const chunk of stream) {
            yield chunk;
        }
    }
}

export const summarizeChapter = async (content: string, settings: NovelSettings, onUsage?: any): Promise<string> => {
    const { model, apiKey, provider } = getModelConfig(settings);
    const prompt = `Summarize the following chapter content into a concise paragraph (max 200 words).
    Focus on key plot events and character developments.
    ${settings.language === 'zh' ? "Output: Chinese" : "Output: English"}

    Content:
    "${content.slice(0, 15000)}"`;

    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const config: any = {};
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const response = await withRetry(() => ai.models.generateContent({ model, contents: prompt, config }));
        if ((response as any).usageMetadata && onUsage) {
            onUsage({ input: (response as any).usageMetadata.promptTokenCount || 0, output: (response as any).usageMetadata.candidatesTokenCount || 0 });
        }
        return (response as any).text || "";
    } else {
        const url = getBaseUrl(settings);
        const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: prompt}], undefined, undefined, settings.maxOutputTokens, onUsage);
        return text;
    }
};

export const checkConsistency = async (content: string, characters: Character[], settings: NovelSettings, onUsage?: any): Promise<string> => {
    const { model, apiKey, provider } = getModelConfig(settings);
    const template = getPromptTemplate(PROMPT_KEYS.CHECK_CONSISTENCY, settings);
    const charStr = characters.map(c => `${c.name} (${c.role}): ${c.description}`).join('\n');
    
    const prompt = fillPrompt(template, {
        characters: charStr,
        content: content.slice(0, 20000)
    });

    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const config: any = {};
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const response = await withRetry(() => ai.models.generateContent({ model, contents: prompt, config }));
        if ((response as any).usageMetadata && onUsage) {
            onUsage({ input: (response as any).usageMetadata.promptTokenCount || 0, output: (response as any).usageMetadata.candidatesTokenCount || 0 });
        }
        return (response as any).text || "Analysis failed.";
    } else {
         const url = getBaseUrl(settings);
         const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: prompt}], undefined, undefined, settings.maxOutputTokens, onUsage);
         return text;
    }
};

export const fixChapterConsistency = async (content: string, characters: Character[], analysis: string, settings: NovelSettings, onUsage?: any): Promise<string> => {
    const { model, apiKey, provider } = getModelConfig(settings);
    const template = getPromptTemplate(PROMPT_KEYS.FIX_CONSISTENCY, settings);
    const charStr = characters.map(c => `${c.name} (${c.role}): ${c.description}`).join('\n');
    
    const prompt = fillPrompt(template, {
        analysis: analysis,
        characters: charStr,
        content: content
    });

    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const config: any = {};
        if (settings.maxOutputTokens) config.maxOutputTokens = settings.maxOutputTokens;
        
        const response = await withRetry(() => ai.models.generateContent({ model, contents: prompt, config }));
        if ((response as any).usageMetadata && onUsage) {
            onUsage({ input: (response as any).usageMetadata.promptTokenCount || 0, output: (response as any).usageMetadata.candidatesTokenCount || 0 });
        }
        return (response as any).text || content;
    } else {
        const url = getBaseUrl(settings);
        const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: prompt}], undefined, undefined, settings.maxOutputTokens, onUsage);
        return text;
    }
};
