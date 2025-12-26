import { GoogleGenAI, Type, Schema } from "@google/genai";
import { NovelSettings, Chapter, ModelProvider, Character } from "../types";

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
            
            if ((isRateLimit || isServer) && i < retries - 1) {
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
          if (i === 2 || (!e.message.includes('429') && !e.message.includes('50'))) throw e;
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

  const promptText = `
    Create a detailed chapter outline for a ${settings.genre} novel titled "${settings.title}".
    ${languageInstruction}
    Premise: ${settings.premise}.
    The novel should be approximately ${settings.targetWordCount} words long.
    Generate exactly ${settings.chapterCount} chapters.
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
      return JSON.parse(jsonText);
  }

  // External Providers (Prompt Engineering for JSON)
  const jsonPrompt = `${promptText}
  
  IMPORTANT: Return valid JSON ONLY. No markdown formatting. No \`\`\`json block.
  Format: [{"id": 1, "title": "...", "summary": "..."}, ...]`;

  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  
  if (!url || !apiKey || !model) throw new Error("Missing provider configuration");

  const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: jsonPrompt}], systemInstruction);
  
  // Clean up potential markdown formatting if model disobeys
  let cleanText = text.trim();
  if (cleanText.startsWith('```json')) cleanText = cleanText.replace('```json', '').replace('```', '');
  if (cleanText.startsWith('```')) cleanText = cleanText.replace('```', '').replace('```', '');
  
  return JSON.parse(cleanText);
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
      return JSON.parse(jsonText);
  }

  // External Providers
  const jsonPrompt = `${promptText}
  
  IMPORTANT: Return valid JSON ONLY. No markdown formatting.
  Format: [{"name": "...", "role": "...", "description": "...", "relationships": "..."}, ...]`;

  const url = getBaseUrl(settings);
  const apiKey = settings.apiKey || "";
  const model = settings.modelName || (settings.provider === 'alibaba' ? 'qwen-plus' : '');
  
  if (!url || !apiKey || !model) throw new Error("Missing provider configuration");

  const text = await fetchOpenAICompatible(url, apiKey, model, [{role: 'user', content: jsonPrompt}], systemInstruction);
  
  let cleanText = text.trim();
  if (cleanText.startsWith('```json')) cleanText = cleanText.replace('```json', '').replace('```', '');
  if (cleanText.startsWith('```')) cleanText = cleanText.replace('```', '').replace('```', '');
  
  return JSON.parse(cleanText);
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

  const promptText = `
    Write Chapter ${chapter.id}: "${chapter.title}" for the ${settings.genre} novel "${settings.title}".
    
    ${languageInstruction}

    Chapter Summary: ${chapter.summary}
    
    Overall Premise: ${settings.premise}
    
    Context from previous chapters: ${previousContext.slice(-2000)} ${previousContext.length > 2000 ? "(...truncated)" : ""}

    IMPORTANT - WRITING STYLE CONFIGURATION:
    - **Tone**: ${settings.writingTone}
    - **Complexity/Style**: ${settings.writingStyle} (Vocabulary and sentence structure)
    - **Narrative Perspective**: ${settings.narrativePerspective}

    GENERAL STYLE GUIDANCE (NO AI FLAVOR):
    - **Personal Style**: Adopt a distinct, immersive narrative voice suitable for the selected tone. Avoid robotic or neutral "assistant" tones.
    - **Show, Don't Tell**: Deeply immerse the reader in the character's sensory experience and internal state. Don't summarize emotions.
    - **Pacing & Rhythm**: Vary sentence length significantly. Use fragments. Use run-on sentences for anxiety. Avoid repetitive subject-verb-object structures.
    - **Avoid Clichés**: Do not use common AI tropes like "shivers ran down spine", "a testament to", or wrapping up with a moral lesson.
    - **Specificity**: Use concrete details and specific nouns/verbs. Avoid vague generalizations.
    - **No Moralizing**: Do not force a summary or lesson at the end of the chapter. End on a beat, an action, or a thought.
    
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

  const promptText = `
    Task: Continue writing the following story segment. 
    Context: Novel Title "${settings.title}", Chapter "${chapterTitle}".
    Genre: ${settings.genre}.
    ${langInstruction}
    
    Configured Style:
    - Tone: ${settings.writingTone}
    - Style: ${settings.writingStyle}
    - Perspective: ${settings.narrativePerspective}
    
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