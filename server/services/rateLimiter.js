/**
 * Rate Limiter Service
 * Enforces 3-second delay between Gemini API calls
 */

class RateLimiter {
    constructor(delayMs = 3000) {
        this.delayMs = delayMs;
        this._queue = [];
        this.isProcessing = false;
        this.lastExecutionTime = 0;
    }

    /**
     * Add a function to the queue and execute with rate limiting
     * @param {Function} fn - Async function to execute
     * @returns {Promise} - Result of the function
     */
    async queue(fn) {
        return new Promise((resolve, reject) => {
            this._queue.push({ fn, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessing || this._queue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this._queue.length > 0) {
            const now = Date.now();
            const timeSinceLastExecution = now - this.lastExecutionTime;
            
            if (timeSinceLastExecution < this.delayMs) {
                const waitTime = this.delayMs - timeSinceLastExecution;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            const { fn, resolve, reject } = this._queue.shift();
            
            try {
                this.lastExecutionTime = Date.now();
                const result = await fn();
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }

        this.isProcessing = false;
    }

    /**
     * Get current queue length
     * @returns {number}
     */
    getQueueLength() {
        return this._queue.length;
    }
}

// Create and export singleton instance
const rateLimiter = new RateLimiter(3000);

export default rateLimiter;
export { rateLimiter };
