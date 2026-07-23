const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export function createBraveProvider({ apiKey = process.env.BRAVE_SEARCH_API_KEY, fetchImpl = fetch } = {}) {
  return {
    id: 'brave',
    async search(query, { limit = 10 } = {}) {
      if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY is required for the Brave search provider');
      const url = new URL(ENDPOINT);
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(Math.min(20, Math.max(1, limit))));
      url.searchParams.set('extra_snippets', 'true');
      const response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'x-subscription-token': apiKey
        }
      });
      if (!response.ok) {
        const error = new Error(`Brave Search returned HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      return (payload.web?.results || []).map((result) => ({
        title: result.title || '',
        url: result.url,
        publisher: result.profile?.long_name || '',
        publishedAt: result.page_age || result.age || '',
        snippet: [result.description, ...(result.extra_snippets || [])].filter(Boolean).join(' '),
        raw: result
      }));
    }
  };
}
