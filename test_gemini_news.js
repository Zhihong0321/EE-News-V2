// const fetch = require('node-fetch'); // Built-in in Node 18+

async function getNews() {
    const url = 'https://ee-gemini-api-production.up.railway.app/chat';
    const payload = {
        message: "What are the top 3 global news headlines right now? Please provide a brief summary for each.",
        model: "gemini-2.5-flash"
    };

    try {
        console.log(`Sending request to ${url}...`);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log("Response received:");
        console.log(JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error fetching news:", error);
    }
}

async function checkHealth() {
    const url = 'https://ee-gemini-api-production.up.railway.app/health';
    for (let i = 0; i < 10; i++) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            console.log(`Attempt ${i + 1}: Status=${data.status}, Ready=${data.client_ready}`);
            if (data.client_ready) {
                console.log("Client is ready!");
                return true;
            }
        } catch (e) {
            console.error("Health check failed:", e);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

checkHealth().then(ready => {
    if (ready) getNews();
    else console.log("API not ready after retries.");
});
