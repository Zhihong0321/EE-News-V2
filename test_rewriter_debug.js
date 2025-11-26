/**
 * Debug Rewriter GEMS Response
 */

import { chat } from './server/services/geminiApi.js';
import { REWRITER_PROMPT_TEMPLATE, fillTemplate } from './server/config/prompts.js';

async function debugRewriter() {
    const REWRITER_GEMS_URL = 'https://gemini.google.com/gem/ba97012d9ebf';

    const testHeadline = 'Malaysia launches new solar initiative worth RM500 million';
    const testDate = 'November 2025';
    const testQuery = 'Search for latest solar energy news in Malaysia';

    const prompt = fillTemplate(REWRITER_PROMPT_TEMPLATE, {
        HEADLINE: testHeadline,
        DATE: testDate,
        SEARCH_QUERY: testQuery
    });

    console.log('Sending request...\n');

    const result = await chat(prompt, REWRITER_GEMS_URL);

    console.log('=== FULL RESPONSE ===');
    console.log(result.response);
    console.log('\n=== END RESPONSE ===\n');

    // Try to find JSON
    const jsonMatch = result.response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        console.log('=== EXTRACTED JSON ===');
        console.log(jsonMatch[0]);
        console.log('\n=== PARSED ===');
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(JSON.stringify(parsed, null, 2));
    }
}

debugRewriter();
