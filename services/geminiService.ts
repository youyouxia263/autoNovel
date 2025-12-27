import { GoogleGenAI, Type, Schema } from "@google/genai";
import { NovelSettings, Chapter, ModelProvider, Character, GrammarIssue } from "../types";

const GEMINI_API_KEY = process.env.API_KEY || '';

// --- Universal Helpers ---

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
            // 'Failed to fetch' is usually a network error (or CORS)
            const isNetwork = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch failed');
            
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
    
    // 1. Remove markdown code blocks first
    let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    // Helper to attempt parse
    const tryParse = (str: string) => {
        try {
            return JSON.parse(str);
        } catch (e) {
            return null;
        }
    };

    // 2. Try parsing directly
    let result = tryParse(clean);
    if (result) return result;

    // 3. Try fixing unquoted values (Common error with Chinese text in LLMs)
    // Pattern: "key": value (where value is missing quotes)
    const fixUnquoted = (str: string) => {
        // Look for "key": value where value doesn't start with quote, brace, bracket, or number/bool keywords
        // We look for specific keys to avoid false positives and only matching until the next comma or closing brace
        const keys = ['summary', 'title', 'description', 'relationships', 'name', 'role', 'content', 'id', 'original', 'suggestion', 'explanation'];
        let fixed = str;
        
        keys.forEach(key => {
             if (key === 'id') return; // id is usually a number, skip
             // Regex explanation:
             // "key"\s*:\s*  -> matches "key": 
             // (?![{\["\d]|true|false|null) -> Negative lookahead: verify next char is NOT {, [, ", digit, or true/false/null
             // ([^,}\]]+) -> Capture everything until a comma, closing brace, or closing bracket
             const regex = new RegExp(`"${key}"\\s*:\\s*(?![{\\["\\d]|true|false|null)([^,}\\]]+)`, 'g');
             
             fixed = fixed.replace(regex, (match, val) => {
                const trimmed = val.trim();
                // Double check it's not a number (sometimes models output numbers as strings without quotes is fine, but we need strings)
                if (!isNaN(Number(trimmed))) return match; 
                return `"${key}": "${trimmed.replace(/"/g, '\\"')}"`;
             });
        });
        return fixed;
    };
    
    result = tryParse(fixUnquoted(clean));
    if (result) return result;

    // 4. Extraction Fallback (if surrounded by conversational text)
    // Extract array
    const firstBracket = clean.indexOf('[');
    const lastBracket = clean.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        const arrayStr = clean.substring(firstBracket, lastBracket + 1);
        result = tryParse(arrayStr);
        if (result) return result;
        // Try fixing the array string
        result = tryParse(fixUnquoted(arrayStr));
        if (result) return result;
    }
    
    // Extract object
    const firstCurly = clean.indexOf('{');
    const lastCurly = clean.lastIndexOf('}');
    if (firstCurly !== -1 && lastCurly !== -1 && lastCurly > firstCurly) {
        const objStr = clean.substring(firstCurly, lastCurly + 1);
        result = tryParse(objStr);
        if (result) return result;
        // Try fixing
        result = tryParse(fixUnquoted(objStr));
        if (result) return result;
    }
    
    console.error("JSON Parse Failed. Raw:", text);
    throw new Error(`JSON Parse Error: Could not parse or repair output. Raw: ${text.slice(0, 50)}...`);
}

// --- OpenAI-Compatible Stream Parser Helper ---
async function* streamOpenAICompatible(url: string, apiKey: string, model: string, messages: any[], systemInstruction?: string, temperature: number = 0.7) {
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
    temperature: temperature
  };

  let response: Response | null = null;
  
  // Custom retry loop for the fetch part
  for(let i=0; i<3; i++) {
      try {
        response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
             const errorText = await response.text();
             // Check if retryable
             if (response.status === 429 || response.status >= 500) {
                 throw new Error(`Provider API Error: ${response.status} ${errorText}`);
             }
             // Non-retryable
             throw new Error(`Provider API Error: ${response.status} ${errorText}`);
        }
        break; // Success
      } catch (e: any) {
          const msg = e.message || '';
          const isNetwork = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch failed');
          const isRateLimit = msg.includes('429');
          const isServer = msg.includes('50'); // 500, 502, etc
          
          if (i === 2 || (!isNetwork && !isRateLimit && !isServer)) throw e;
          console.warn(`Stream connection failed (${msg}). Retrying...`);
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
        const content = json.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch (e) {
        // ignore parse error for partial lines
      }
    }
  }
}

// --- OpenAI-Compatible One-Shot Helper ---
async function fetchOpenAICompatible(url: string, apiKey: string, model: string, messages: any[], systemInstruction?: string) {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const body = {
        model: model,
        messages: [
             ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
             ...messages
        ],
        stream: false
    };

    return await withRetry(async () => {
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if(!response.ok) {
            const txt = await response.text();
            throw new Error(`API Error: ${response.status} ${txt}`);
        }
        const json = await response.json();
        return json.choices?.[0]?.message?.content || "";
    });
}

// --- Style Instruction Generator ---
const getStyleInstructions = (settings: NovelSettings) => {
    let instructions = "";

    // Complexity Rules
    switch (settings.writingStyle) {
        case 'Simple':
            instructions += "\n- **Complexity**: Low (CEFR B2). Use simple, everyday vocabulary. Keep sentences short and direct. Avoid convoluted clauses. Focus on action over description.";
            break;
        case 'Complex':
            instructions += "\n- **Complexity**: High. Use sophisticated, precise, and academic vocabulary. Use varied sentence structures, including compound-complex sentences. Deeply explore psychological states.";
            break;
        case 'Poetic':
            instructions += "\n- **Complexity**: Artistic. Prioritize lyrical rhythm, sensory imagery, and atmosphere. Use metaphors and similes generously. The prose should feel like a painting.";
            break;
        case 'Moderate':
        default:
            instructions += "\n- **Complexity**: Moderate. Standard literary fiction. Balance simple and compound sentences. Mix action with introspection.";
            break;
    }

    // Perspective Rules
    switch (settings.narrativePerspective) {
        case 'First Person':
            instructions += "\n- **Perspective**: First Person ('I'). The narrative must be deeply subjective. Limit knowledge ONLY to what the narrator perceives or feels. Do not describe things they cannot see.";
            break;
        case 'Third Person Omniscient':
            instructions += "\n- **Perspective**: Third Person Omniscient. The narrator knows all. You may dip into the thoughts of multiple characters within a scene and provide context unknown to the characters.";
            break;
        case 'Third Person Limited':
        default:
            instructions += "\n- **Perspective**: Third Person Limited. Write from the 'He/She' perspective but bound STRICTLY to the protagonist's internal experience. Do not 'head-hop' to other characters' thoughts.";
            break;
    }

    // Tone Rules
    instructions += `\n- **Tone**: ${settings.writingTone}.`;

    return instructions;
};

// --- Provider Specifics ---

const getBaseUrl = (settings: NovelSettings) => {
    if (settings.provider === 'alibaba') return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    if (settings.provider === 'volcano') return "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
    if (settings.provider === 'custom') return settings.baseUrl || "";
    return "";
}

// --- Exported Functions ---

/**
 * Generates a premise based on the title, or expands an existing premise.
 */
export const generatePremise = async (title: string, currentPremise: string, settings: NovelSettings): Promise<string> => {
  
  const language = settings.language;
  const genre = settings.genre;

  const langInstruction = language === 'zh'
    ? "OUTPUT LANGUAGE: Chinese (Simplified)."
    : "OUTPUT LANGUAGE: English.";

  const task = currentPremise && currentPremise.trim().length > 0
    ? `The user has provided a rough idea: "${currentPremise}". Expand this into a compelling, detailed plot summary (about 100-200 words) for a ${genre} novel.`
    : `Create a compelling, detailed plot summary (about 100-200 words) for a ${genre} novel titled "${title}".`;

  const promptText = `
    Task: ${task}
    ${langInstruction}
    Requirements:
    - Include the main conflict, protagonist, and stakes.
    - Make it intriguing and suitable for the back cover of a book.
    - Return ONLY the summary text, no conversational filler.
  `;
  const systemInstruction = "You are a helpful creative writing assistant.";

  // Gemini Path
  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-flash-preview";
      const response = await withRetry(() => ai.models.generateContent({
        model: model,
        contents: promptText,
        config: { systemInstruction },
      }));
      return response.text || "";
  }
  
  // External Provider Path
  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  
  if (!url || !apiKey || !model) throw new Error("Missing provider configuration");

  return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction);
};

/**
 * Summarizes the generated chapter content.
 */
export const summarizeChapter = async (content: string, settings: NovelSettings): Promise<string> => {
  const genre = settings.genre;
  const language = settings.language;

  const langInstruction = language === 'zh'
    ? "OUTPUT LANGUAGE: Chinese (Simplified)."
    : "OUTPUT LANGUAGE: English.";

  const promptText = `
    Task: Summarize the following chapter content in 2-3 sentences. Capture the key plot points and character developments.
    Genre: ${genre}
    ${langInstruction}
    
    Content:
    ${content.slice(0, 15000)} 
  `;
  const systemInstruction = "You are an expert editor.";

  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-flash-preview";
      const response = await withRetry(() => ai.models.generateContent({
        model: model,
        contents: promptText,
        config: { systemInstruction }
      }));
      return response.text || "";
  }

  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  
  if (!url || !apiKey || !model) return ""; // Fail gracefully for summary

  try {
      return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction);
  } catch (e) {
      console.error("Summary failed", e);
      return "";
  }
};

/**
 * Generates an outline (list of chapters) based on the novel settings.
 */
export const generateOutline = async (settings: NovelSettings): Promise<Omit<Chapter, 'content' | 'isGenerating' | 'isDone'>[]> => {
  
  const languageInstruction = settings.language === 'zh' 
    ? "OUTPUT LANGUAGE: Chinese (Simplified). Ensure all titles and summaries are in Chinese." 
    : "OUTPUT LANGUAGE: English.";

  const formatInstruction = settings.novelType === 'short'
    ? `Format: Short Story (${settings.targetWordCount} words). Structure the outline to have a tight pacing, complete character arc, and a definitive conclusion within ${settings.chapterCount} chapters.`
    : `Format: Long Novel Series. Plan for a sprawling narrative arc.`;

  const promptText = `
    Create a detailed chapter outline for a ${settings.genre} novel titled "${settings.title}".
    ${languageInstruction}
    Premise: ${settings.premise}.
    ${formatInstruction}
    
    IMPORTANT - STRUCTURE:
    The user requested *at least* ${settings.chapterCount} chapters. 
    You may generate more chapters if necessary to ensure the story has a complete, well-paced narrative arc.
    The final chapter MUST conclude the story (unless it's a long series, but usually short stories must end).
    
    For each chapter, provide a creative title and a 2-3 sentence summary of the plot points that happen in that chapter.
    Ensure the plot flows logically and maintains the tone of a ${settings.genre} novel.
  `;
  const systemInstruction = "You are an expert novelist and editor specializing in plotting best-selling fiction.";

  // Gemini (with JSON Schema)
  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-flash-preview";
      const responseSchema: Schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.INTEGER, description: "Chapter number, starting from 1" },
            title: { type: Type.STRING, description: "Creative chapter title" },
            summary: { type: Type.STRING, description: "Detailed summary of the chapter events" },
          },
          required: ["id", "title", "summary"],
        },
      };

      const response = await withRetry(() => ai.models.generateContent({
        model: model,
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          systemInstruction: systemInstruction,
        },
      }));

      const jsonText = response.text || "[]";
      return cleanAndParseJson(jsonText);
  }

  // External Providers (Prompt Engineering for JSON)
  const jsonPrompt = `${promptText}
  
  IMPORTANT: Return valid JSON ONLY. No markdown formatting. No \`\`\`json block. 
  CRITICAL: You MUST enclose all keys and string values in DOUBLE QUOTES. Example: "title": "Chapter 1".
  Format: [{"id": 1, "title": "...", "summary": "..."}, ...]`;

  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  
  if (!url || !apiKey || !model) throw new Error("Missing provider configuration");

  const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: jsonPrompt}], systemInstruction);
  
  return cleanAndParseJson(text);
};

/**
 * Generates character profiles.
 */
export const generateCharacters = async (settings: NovelSettings): Promise<Character[]> => {
  const languageInstruction = settings.language === 'zh'
    ? "OUTPUT LANGUAGE: Chinese (Simplified)."
    : "OUTPUT LANGUAGE: English.";

  const promptText = `
    Create a list of 3-6 main characters for a ${settings.genre} novel titled "${settings.title}".
    Premise: ${settings.premise}
    ${languageInstruction}
    
    For each character provide:
    - Name
    - Role (Protagonist, Antagonist, Sidekick, etc.)
    - Description (Personality, appearance, goal)
    - Relationships (How they are related to other characters in the list)
  `;
  const systemInstruction = "You are a character designer.";

  // Gemini (with JSON Schema)
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

      const response = await withRetry(() => ai.models.generateContent({
        model: model,
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          systemInstruction: systemInstruction,
        },
      }));

      const jsonText = response.text || "[]";
      return cleanAndParseJson(jsonText);
  }

  // External Providers
  const jsonPrompt = `${promptText}
  
  IMPORTANT: Return valid JSON ONLY. No markdown formatting.
  CRITICAL: You MUST enclose all keys and string values in DOUBLE QUOTES. Example: "name": "John".
  Format: [{"name": "...", "role": "...", "description": "...", "relationships": "..."}, ...]`;

  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  
  if (!url || !apiKey || !model) throw new Error("Missing provider configuration");

  const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: jsonPrompt}], systemInstruction);
  
  return cleanAndParseJson(text);
};

/**
 * Checks consistency of a chapter against character profiles.
 */
export const checkConsistency = async (chapterContent: string, characters: Character[], settings: NovelSettings): Promise<string> => {
  const languageInstruction = settings.language === 'zh'
    ? "OUTPUT LANGUAGE: Chinese (Simplified)."
    : "OUTPUT LANGUAGE: English.";
  
  const charContext = characters.map(c => 
    `${c.name} (${c.role}): ${c.description}. Relationships: ${c.relationships}`
  ).join('\n');

  const promptText = `
    Analyze the following chapter content for consistency with the established character profiles.
    
    Character Profiles:
    ${charContext}
    
    Chapter Content:
    ${chapterContent.slice(0, 15000)}
    
    ${languageInstruction}
    
    Task:
    Check for:
    1. Contradictions in relationships (e.g., characters who are enemies acting like best friends without explanation).
    2. Character behavior that contradicts their core description (unless it's character development).
    3. Continuity errors (e.g., dead characters appearing).
    
    Output:
    If consistent, return "Consistent".
    If inconsistencies found, list them briefly as bullet points.
  `;
  const systemInstruction = "You are a continuity editor.";

  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-flash-preview";
      const response = await withRetry(() => ai.models.generateContent({
        model: model,
        contents: promptText,
        config: { systemInstruction }
      }));
      return response.text || "Consistent";
  }

  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  
  if (!url || !apiKey || !model) return "Skipped check";

  try {
      return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction);
  } catch (e) {
      return "Check failed";
  }
};

/**
 * Automatically rewrites a chapter to fix consistency issues.
 */
export const fixChapterConsistency = async (
    chapterContent: string, 
    characters: Character[], 
    analysis: string, 
    settings: NovelSettings
): Promise<string> => {
  const languageInstruction = settings.language === 'zh'
    ? "OUTPUT LANGUAGE: Chinese (Simplified)."
    : "OUTPUT LANGUAGE: English.";
  
  const charContext = characters.map(c => 
    `${c.name} (${c.role}): ${c.description}. Relationships: ${c.relationships}`
  ).join('\n');

  const promptText = `
    You are an expert editor. Your task is to rewrite the provided chapter content to fix specific consistency errors identified in an analysis report.
    
    Character Profiles:
    ${charContext}
    
    Consistency Analysis Report (Issues to fix):
    ${analysis}
    
    Original Chapter Content:
    ${chapterContent}
    
    ${languageInstruction}
    
    Instructions:
    1. Rewrite the chapter content to preserve the original plot and writing style as much as possible.
    2. ONLY change parts necessary to resolve the inconsistencies listed in the report.
    3. Ensure character actions and dialogue match their profiles.
    4. Return the full corrected chapter content.
  `;
  const systemInstruction = "You are a meticulous editor specializing in narrative consistency.";

  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-flash-preview";
      const response = await withRetry(() => ai.models.generateContent({
        model: model,
        contents: promptText,
        config: { systemInstruction }
      }));
      return response.text || chapterContent;
  }

  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  
  if (!url || !apiKey || !model) throw new Error("Missing configuration");

  return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction);
};

/**
 * Checks grammar and spelling.
 */
export const checkGrammar = async (content: string, settings: NovelSettings): Promise<GrammarIssue[]> => {
  const languageInstruction = settings.language === 'zh'
    ? "OUTPUT LANGUAGE: Chinese (Simplified) for suggestions."
    : "OUTPUT LANGUAGE: English.";

  const promptText = `
    Analyze the following text for grammar, spelling, punctuation, and stylistic errors.
    
    ${languageInstruction}
    
    Text:
    ${content.slice(0, 10000)}
    
    Return a list of the most important issues (max 20).
    Provide the original text segment, the suggested correction, and a brief explanation.
    If the text is mostly correct or artistic choices are intentional, be lenient.
  `;
  const systemInstruction = "You are a copy editor.";

  // Gemini (JSON Schema)
  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-flash-preview";
      const responseSchema: Schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            original: { type: Type.STRING },
            suggestion: { type: Type.STRING },
            explanation: { type: Type.STRING },
          },
          required: ["original", "suggestion", "explanation"],
        },
      };

      const response = await withRetry(() => ai.models.generateContent({
        model: model,
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          systemInstruction: systemInstruction,
        },
      }));

      const jsonText = response.text || "[]";
      return cleanAndParseJson(jsonText);
  }

  // External Provider
  const jsonPrompt = `${promptText}
  
  IMPORTANT: Return valid JSON ONLY. Format: [{"original": "...", "suggestion": "...", "explanation": "..."}, ...]`;
  
  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  
  if (!url || !apiKey || !model) return [];

  try {
      const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: jsonPrompt}], systemInstruction);
      return cleanAndParseJson(text);
  } catch (e) {
      console.error(e);
      return [];
  }
};

/**
 * Auto-corrects grammar in the text.
 */
export const autoCorrectGrammar = async (content: string, settings: NovelSettings): Promise<string> => {
    const languageInstruction = settings.language === 'zh'
      ? "OUTPUT LANGUAGE: Chinese (Simplified)."
      : "OUTPUT LANGUAGE: English.";
  
    const promptText = `
      You are an expert proofreader. Rewrite the following text to fix all grammar, spelling, and punctuation errors.
      
      ${languageInstruction}
      
      Requirements:
      - Fix all objective errors.
      - Preserve the original tone, style, and meaning exactly.
      - Do not summarize or cut content.
      - Return the full corrected text.
      
      Original Text:
      ${content}
    `;
    const systemInstruction = "You are a professional proofreader.";
  
    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const model = settings.modelName || "gemini-3-flash-preview";
        const response = await withRetry(() => ai.models.generateContent({
          model: model,
          contents: promptText,
          config: { systemInstruction }
        }));
        return response.text || content;
    }
  
    const url = getBaseUrl(settings);
    const apiKey = settings.apiKey || "";
    const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
    
    if (!url || !apiKey || !model) throw new Error("Missing configuration");
  
    return await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction);
  };

/**
 * Generates the content for a specific chapter.
 * Returns an async generator to stream the text.
 */
export const generateChapterStream = async function* (
  settings: NovelSettings,
  chapter: Chapter,
  previousContext: string = ""
) {

  const languageInstruction = settings.language === 'zh' 
    ? "IMPORTANT: Write the story content in Chinese (Simplified)." 
    : "IMPORTANT: Write the story content in English.";

  const styleInstructions = getStyleInstructions(settings);

  const promptText = `
    Write Chapter ${chapter.id}: "${chapter.title}" for the ${settings.genre} novel "${settings.title}".
    
    ${languageInstruction}

    Chapter Summary: ${chapter.summary}
    
    Overall Premise: ${settings.premise}
    
    Context from previous chapters: ${previousContext.slice(-2000)} ${previousContext.length > 2000 ? "(...truncated)" : ""}

    IMPORTANT - STYLE GUIDELINES:
    ${styleInstructions}

    GENERAL RULES:
    - **Personal Style**: Adopt a distinct, immersive narrative voice. Avoid robotic or neutral "assistant" tones.
    - **Show, Don't Tell**: Deeply immerse the reader in the character's sensory experience.
    - **Pacing**: Vary sentence length significantly to match the scene's tension.
    - **Avoid Clichés**: Do not use common AI tropes like "shivers ran down spine", "a testament to".
    - **No Moralizing**: Do not force a summary or lesson at the end.
    
    Length: Aim for approximately ${Math.round(settings.targetWordCount / settings.chapterCount)} words.
    Output only the story content. Do not include the title or summary again.
  `;
  const systemInstruction = "You are a best-selling author known for a unique, authentic, and highly personal writing style. You despise generic, robotic writing.";

  // Gemini Path
  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-pro-preview";
      const isDefaultModel = !settings.modelName;

      // Only enable thinking budget if using the default high-quality model, 
      // or if user hasn't specified a model (safest default). 
      // If user forces a different model (e.g. gemini-2.0-flash-exp), we assume they know what they are doing.
      // But thinkingConfig is only for 2.5/3 series.
      const config: any = { systemInstruction };
      if (isDefaultModel) {
          config.thinkingConfig = { thinkingBudget: 2048 };
      }

      const stream = await withRetry(() => ai.models.generateContentStream({
        model: model,
        contents: promptText,
        config: config
      }));

      for await (const chunk of stream) {
        if (chunk.text) yield chunk.text;
      }
      return;
  }

  // External Provider Path
  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');

  if (!url || !apiKey || !model) throw new Error("Missing configuration");

  const stream = streamOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction);
  for await (const text of stream) {
      yield text;
  }
};

/**
 * Continues writing based on existing content.
 */
export const continueWriting = async function* (
  currentContent: string,
  settings: NovelSettings,
  chapterTitle: string
) {
  const langInstruction = settings.language === 'zh' ? "Output in Chinese (Simplified)." : "Output in English.";
  const styleInstructions = getStyleInstructions(settings);

  const promptText = `
    Task: Continue writing the following story segment. 
    Context: Novel Title "${settings.title}", Chapter "${chapterTitle}".
    Genre: ${settings.genre}.
    ${langInstruction}
    
    STYLE CONFIGURATION:
    ${styleInstructions}
    
    Current Text (End of chapter so far):
    ${currentContent.slice(-4000)}

    Instructions:
    - Pick up exactly where the text leaves off.
    - **Style**: Maintain a natural, human-like flow. Avoid robotic transitions.
    - **Focus**: Concrete sensory details and deep character psychology.
    - **Avoid**: Summary statements or repetitive sentence structures.
    - Write about 200-400 words.
    - Do not repeat the last sentence, just continue.
  `;
  const systemInstruction = "You are a co-author and editor known for authentic human-like writing.";

  if (settings.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = settings.modelName || "gemini-3-flash-preview"; // Use Flash for quick continue unless override
      const stream = await withRetry(() => ai.models.generateContentStream({
        model: model,
        contents: promptText,
        config: { systemInstruction }
      }));

      for await (const chunk of stream) {
        if (chunk.text) yield chunk.text;
      }
      return;
  }

  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');

  if (!url || !apiKey || !model) throw new Error("Missing configuration");

  const stream = streamOpenAICompatible(url, apiKey, model, [{role: 'user', content: promptText}], systemInstruction);
  for await (const text of stream) {
      yield text;
  }
};