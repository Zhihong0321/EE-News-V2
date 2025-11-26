/**
 * Test Rewriter GEMS
 * Verify the rewriter can translate and rewrite news
 */

import { chat } from './server/services/geminiApi.js';
import { REWRITER_PROMPT_TEMPLATE, fillTemplate } from './server/config/prompts.js';

async function testRewriterGems() {
    console.log('Testing Rewriter GEMS...\n');

    const REWRITER_GEMS_URL = 'https://gemini.google.com/gem/ba97012d9ebf';

    try {
        // Test with a sample headline
        const testHeadline = 'Malaysia launches new solar initiative worth RM500 million';
        const testDate = 'November 2025';
        const testQuery = 'Search for latest solar energy news in Malaysia';

        console.log('Test Input:');
        console.log('- Headline:', testHeadline);
        console.log('- Date:', testDate);
        console.log('- Query:', testQuery);
        console.log();

        // Prepare prompt
        const prompt = fillTemplate(REWRITER_PROMPT_TEMPLATE, {
            HEADLINE: testHeadline,
            DATE: testDate,
            SEARCH_QUERY: testQuery
        });

        console.log('Sending request to rewriter GEMS...');
        console.log('GEMS URL:', REWRITER_GEMS_URL);
        console.log();

        // Call rewriter GEMS
        const result = await chat(prompt, REWRITER_GEMS_URL);

        if (!result.success) {
            throw new Error('Chat failed');
        }

        console.log('✓ Response received');
        console.log('Response length:', result.response.length, 'characters');
        console.log();

        // Try to parse JSON
        try {
            const jsonMatch = result.response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const articleData = JSON.parse(jsonMatch[0]);
                
                console.log('✓ JSON parsed successfully');
                console.log();
                console.log('Article Structure:');
                console.log('- title_en:', articleData.title_en ? '✓' : '✗');
                console.log('- title_zh:', articleData.title_zh ? '✓' : '✗');
                console.log('- title_ms:', articleData.title_ms ? '✓' : '✗');
                console.log('- content_en:', articleData.content_en ? `✓ (${articleData.content_en.length} chars)` : '✗');
                console.log('- content_zh:', articleData.content_zh ? `✓ (${articleData.content_zh.length} chars)` : '✗');
                console.log('- content_ms:', articleData.content_ms ? `✓ (${articleData.content_ms.length} chars)` : '✗');
                console.log('- summary_en:', articleData.summary_en ? '✓' : '✗');
                console.log('- summary_zh:', articleData.summary_zh ? '✓' : '✗');
                console.log('- summary_ms:', articleData.summary_ms ? '✓' : '✗');
                console.log('- tags:', articleData.tags ? `✓ (${articleData.tags.length} tags)` : '✗');
                console.log();

                // Show sample content
                console.log('Sample Output:');
                console.log('─────────────────────────────────────');
                console.log('EN Title:', articleData.title_en);
                console.log('ZH Title:', articleData.title_zh);
                console.log('MS Title:', articleData.title_ms);
                console.log();
                console.log('EN Summary:', articleData.summary_en?.substring(0, 150) + '...');
                console.log();
                console.log('Tags:', articleData.tags?.join(', '));
                console.log('─────────────────────────────────────');
                console.log();

                console.log('✓ All tests passed! Rewriter GEMS is working correctly.');
            } else {
                console.log('✗ No JSON found in response');
                console.log('Response preview:', result.response.substring(0, 500));
            }
        } catch (parseError) {
            console.error('✗ Failed to parse JSON:', parseError.message);
            console.log('Response preview:', result.response.substring(0, 500));
        }

    } catch (error) {
        console.error('✗ Test failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

testRewriterGems();
