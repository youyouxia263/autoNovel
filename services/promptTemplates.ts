
// This file contains the default prompts used by the system.
// Users can override these by saving custom strings in NovelSettings.customPrompts

export const PROMPT_KEYS = {
    GENERATE_OUTLINE: 'generate_outline',
    GENERATE_CHARACTERS: 'generate_characters',
    GENERATE_CHAPTER: 'generate_chapter',
    GENERATE_WORLD: 'generate_world',
    GENERATE_PREMISE: 'generate_premise',
    EXPAND_TEXT: 'expand_text',
    CHECK_CONSISTENCY: 'check_consistency',
    FIX_CONSISTENCY: 'fix_consistency',
    GENERATE_SINGLE_CHARACTER: 'generate_single_character'
} as const;

export const DEFAULT_PROMPTS: Record<string, string> = {
    [PROMPT_KEYS.GENERATE_OUTLINE]: `Create a chapter outline for "{{title}}".
Genres: {{genre}}
{{language}}
Premise: {{premise}}.
{{format}}
{{genreGuide}}
{{world}}
{{characters}}
IMPORTANT - STRUCTURE: {{structure}}
For each chapter, provide 'id', 'title', and 'summary'.`,

    [PROMPT_KEYS.GENERATE_CHAPTER]: `{{task}}
{{language}}

STORY PREMISE:
{{premise}}

OVERARCHING PLOT CONTEXT (PREVIOUS CHAPTERS SUMMARY):
{{storySummaries}}

IMMEDIATE NARRATIVE CONTEXT (PREVIOUS CHAPTER CONTENT):
{{previousChapterContent}}

CURRENT CHAPTER PLAN:
{{chapterSummary}}

CHARACTERS:
{{characters}}

STYLE GUIDELINES:
{{style}}
{{genreGuide}}

CRITICAL INSTRUCTIONS:
- Write the content for Chapter {{chapterId}}.
- **Narrative Continuity**: Use the 'IMMEDIATE NARRATIVE CONTEXT' to ensure a seamless scene transition. The start of this chapter should flow naturally from the exact moment or situation where the previous one ended.
- **Plot Consistency**: Refer to 'OVERARCHING PLOT CONTEXT' to ensure long-term plot threads are respected and progressed.
- **Consistency Check**: Strictly avoid plot holes. Ensure character voices, locations, and inventory/status remain consistent with previous events.
- Do not repeat the previous scene's text, but acknowledge the immediate context.
- Show, don't tell.`,

    [PROMPT_KEYS.GENERATE_CHARACTERS]: `Create {{count}} distinct and diverse main characters for "{{title}}".
Genres: {{genre}}
Premise: {{premise}}
{{language}}
{{genreGuide}}
{{world}}
{{characters}}

Guidelines:
- Ensure a mix of roles (protagonist, antagonist, supporting, foil).
- Avoid common tropes and stereotypes.
- Create multidimensional characters with unique motivations and flaws.
- Ensure diversity in background, personality, and skills where appropriate for the setting.

Provide: name, role, description, relationships.`,

    [PROMPT_KEYS.GENERATE_SINGLE_CHARACTER]: `Task: Create ONE new character for "{{title}}" who interacts with: {{existingNames}}. 
Genres: {{genre}}. 
{{language}}. 
Premise: {{premise}}. 
Provide: name, role, description, relationships.`,

    [PROMPT_KEYS.GENERATE_WORLD]: `Task: Create a World Setting for "{{title}}". 
Genres: {{genre}}. 
{{language}}. 
Premise: {{premise}}. 
{{specificPrompt}}. 
Keep it under 300 words.`,

    [PROMPT_KEYS.GENERATE_PREMISE]: `Task: {{task}}. 
Genres: {{genre}}. 
{{language}}. 
Return ONLY summary text.`,

    [PROMPT_KEYS.EXPAND_TEXT]: `You are a creative writing assistant.
Task: Expand the following {{contextType}} for a {{genre}} novel titled "{{title}}".
{{language}}

Original Input:
"{{currentText}}"

Instructions:
- Flesh out the details, adding depth, atmosphere, and specific elements suitable for the genre.
- Keep the core idea but make it richer and more evocative.
- If the input is very short, creatively brainstorm based on it.
- Length: Approximately 200-300 words.
- Output ONLY the expanded text.`,

    [PROMPT_KEYS.CHECK_CONSISTENCY]: `Analyze consistency.
Profiles:
{{characters}}
Content:
{{content}}`,

    [PROMPT_KEYS.FIX_CONSISTENCY]: `Rewrite to fix consistency.
Issues:
{{analysis}}
Profiles:
{{characters}}
Content:
{{content}}`
};

export const fillPrompt = (template: string, data: Record<string, string>): string => {
    let result = template;
    for (const key in data) {
        // Replace {{key}} with value, handling mostly simple cases
        const placeholder = `{{${key}}}`;
        // Use a global replace
        result = result.split(placeholder).join(data[key] || '');
    }
    return result;
};
