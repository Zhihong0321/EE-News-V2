/**
 * Gemini API Service
 * Wrapper for Gemini API with rate limiting
 */

import rateLimiter from './rateLimiter.js';

const GEMINI_API_URL = process.env.GEMINI_API_URL || 'https://ee-gemini-api-production.up.railway.app';

/**
 * Check Gemini API health status
 * @returns {Promise<{status: string, client_ready: boolean}>}
 */
export async function checkHealth() {
    return rateLimiter.queue(async () => {
        const response = await fetch(`${GEMINI_API_URL}/health`);
        if (!response.ok) {
            throw new Error(`Health check failed: ${response.status}`);
        }
        return response.json();
    });
}

/**
 * List available GEMS
 * @returns {Promise<Array<{name: string, id: string, gem_id: string, desc: string}>>}
 */
export async function listGems() {
    return rateLimiter.queue(async () => {
        const response = await fetch(`${GEMINI_API_URL}/gems`);
        if (!response.ok) {
            throw new Error(`List GEMS failed: ${response.status}`);
        }
        const data = await response.json();
        // Return the merged list which includes both stored and generated GEMS
        return data.merged || [];
    });
}

/**
 * Send a chat message to a GEMS
 * @param {string} message - Message to send
 * @param {string} gemsUrl - GEMS URL
 * @param {string} accountId - Account ID (optional)
 * @returns {Promise<{response: string, success: boolean}>}
 */
export async function chat(message, gemsUrl, accountId = null) {
    return rateLimiter.queue(async () => {
        const body = {
            message,
            system_prompt: gemsUrl  // Use system_prompt for GEMS
        };

        if (accountId) {
            body.account_id = accountId;
        }

        const response = await fetch(`${GEMINI_API_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Chat failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return {
            response: data.response || data.message || '',
            success: true
        };
    });
}

/**
 * Get rate limiter queue length
 * @returns {number}
 */
export function getQueueLength() {
    return rateLimiter.getQueueLength();
}
