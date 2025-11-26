/**
 * Prompts Configuration
 * Templates for Gemini API interactions
 */

export const REWRITER_PROMPT_TEMPLATE = `You are a professional news rewriter. Your task is to take a news headline and create a comprehensive, well-researched news article in three languages: English (EN), Chinese (ZH), and Malay (MS).

**Input Headline:** {{HEADLINE}}
**Date:** {{DATE}}
**Search Context:** {{SEARCH_QUERY}}

**Instructions:**
1. Research and expand the headline into a full news article (300-500 words per language)
2. Maintain journalistic integrity and factual accuracy
3. Write in a professional, neutral tone
4. Include relevant context and background information
5. Create appropriate titles for each language
6. Generate concise summaries (50-80 words per language)
7. Extract 3-5 relevant tags

**Output Format (STRICT JSON):**
\`\`\`json
{
  "title_en": "English title here",
  "title_zh": "中文标题",
  "title_ms": "Tajuk Bahasa Melayu",
  "content_en": "Full English article content...",
  "content_zh": "完整的中文文章内容...",
  "content_ms": "Kandungan artikel penuh dalam Bahasa Melayu...",
  "summary_en": "Brief English summary...",
  "summary_zh": "简短的中文摘要...",
  "summary_ms": "Ringkasan ringkas dalam Bahasa Melayu...",
  "tags": ["tag1", "tag2", "tag3"]
}
\`\`\`

**Important:**
- Return ONLY valid JSON, no additional text
- Ensure all fields are properly escaped
- Use proper Unicode for Chinese characters
- Keep content factual and well-researched
- Tags should be lowercase, single words or short phrases`;

/**
 * Replace placeholders in template
 * @param {string} template - Template string
 * @param {Object} values - Values to replace
 * @returns {string}
 */
export function fillTemplate(template, values) {
    let result = template;
    for (const [key, value] of Object.entries(values)) {
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
    }
    return result;
}
