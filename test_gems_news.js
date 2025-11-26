// Test calling the news-search GEMS

const GEMINI_API = 'https://ee-gemini-api-production.up.railway.app';
const NEWS_SEARCH_GEM = 'https://gemini.google.com/gem/c9d02eab1195';

async function testNewsSearchGems() {
    const payload = {
        message: "get me malaysia solar pv news headline from Q2 2025",
        model: "gemini-2.5-flash",
        system_prompt: NEWS_SEARCH_GEM  // Use the GEMS URL
    };

    console.log('Testing news-search GEMS...');
    console.log('Query:', payload.message);
    console.log('GEMS URL:', payload.system_prompt);
    console.log('---');

    try {
        const response = await fetch(`${GEMINI_API}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('Success:', data.success);
        console.log('Model:', data.model);
        console.log('---');
        console.log('Response:');
        console.log(data.response);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testNewsSearchGems();
