/**
 * Test different API parameter formats
 */

const GEMINI_API = 'https://ee-gemini-api-production.up.railway.app';
const NEWS_GEMS = 'https://gemini.google.com/gem/c9d02eab1195';

async function testWithSystemPrompt() {
    console.log('Test 1: Using system_prompt parameter...');
    
    try {
        const response = await fetch(`${GEMINI_API}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: "Test message",
                system_prompt: NEWS_GEMS
            })
        });

        const data = await response.json();
        console.log('✓ Success with system_prompt');
        console.log('Response length:', data.response?.length || 0);
        console.log();
        return true;
    } catch (error) {
        console.log('✗ Failed with system_prompt:', error.message);
        console.log();
        return false;
    }
}

async function testWithGemsUrl() {
    console.log('Test 2: Using gems_url parameter...');
    
    try {
        const response = await fetch(`${GEMINI_API}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: "Test message",
                gems_url: NEWS_GEMS
            })
        });

        const data = await response.json();
        console.log('✓ Success with gems_url');
        console.log('Response length:', data.response?.length || 0);
        console.log();
        return true;
    } catch (error) {
        console.log('✗ Failed with gems_url:', error.message);
        console.log();
        return false;
    }
}

async function runTests() {
    const test1 = await testWithSystemPrompt();
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s
    const test2 = await testWithGemsUrl();
    
    console.log('Results:');
    console.log('- system_prompt:', test1 ? '✓' : '✗');
    console.log('- gems_url:', test2 ? '✓' : '✗');
}

runTests();
