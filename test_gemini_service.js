/**
 * Test Gemini API Service
 */

import { checkHealth, listGems, chat } from './server/services/geminiApi.js';

async function testGeminiService() {
    console.log('Testing Gemini API Service...\n');

    try {
        // Test 1: Health Check
        console.log('1. Testing health check...');
        const health = await checkHealth();
        console.log('✓ Health:', JSON.stringify(health, null, 2));
        console.log();

        // Test 2: List GEMS
        console.log('2. Testing list GEMS...');
        const gems = await listGems();
        console.log('✓ GEMS response:', JSON.stringify(gems, null, 2));
        console.log();

        // Test 3: Chat with news-search GEMS
        console.log('3. Testing chat with news-search GEMS...');
        const gemsUrl = 'https://gemini.google.com/gem/c9d02eab1195';
        const message = 'Search for latest solar energy news in Malaysia';
        const chatResult = await chat(message, gemsUrl);
        console.log('✓ Chat success:', chatResult.success);
        console.log('✓ Response length:', chatResult.response.length);
        console.log('✓ Response preview:', chatResult.response.substring(0, 200) + '...');
        console.log();

        console.log('All tests passed! ✓');
    } catch (error) {
        console.error('Test failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

testGeminiService();
