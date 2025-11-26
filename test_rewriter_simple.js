/**
 * Simple Rewriter GEMS Test
 */

import { chat } from './server/services/geminiApi.js';

async function testSimple() {
    console.log('Testing rewriter GEMS with simple message...\n');

    const REWRITER_GEMS_URL = 'https://gemini.google.com/gem/ba97012d9ebf';

    try {
        // Try a very simple message first
        const simpleMessage = 'Hello, can you rewrite this headline: "Malaysia launches solar initiative"';
        
        console.log('Sending:', simpleMessage);
        console.log('To:', REWRITER_GEMS_URL);
        console.log();

        const result = await chat(simpleMessage, REWRITER_GEMS_URL);

        console.log('Success:', result.success);
        console.log('Response:', result.response);

    } catch (error) {
        console.error('Error:', error.message);
        
        // Try with news-search GEMS to compare
        console.log('\nTrying with news-search GEMS for comparison...');
        const NEWS_GEMS_URL = 'https://gemini.google.com/gem/c9d02eab1195';
        
        try {
            const result2 = await chat('Test message', NEWS_GEMS_URL);
            console.log('News-search GEMS works:', result2.success);
        } catch (error2) {
            console.error('News-search also failed:', error2.message);
        }
    }
}

testSimple();
