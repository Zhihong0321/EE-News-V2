export async function runBenchmark(bench, cases) {
  const results = [];
  for (const entry of cases) {
    const result = { id: entry.id, category: entry.category, checks: {}, errors: [] };
    try {
      if (entry.query) {
        const search = await bench.searchWeb(entry.query, { limit: entry.searchLimit || 10 });
        result.checks.searchReturnedResults = search.results.length > 0;
        if (entry.expectedUrlPattern) {
          const pattern = new RegExp(entry.expectedUrlPattern, 'i');
          result.checks.searchRelevant = search.results.some((item) => pattern.test(item.url));
        }
      }
      if (entry.url) {
        const document = await bench.fetchPage(entry.url, { date: entry.date });
        result.document = document;
        result.checks.fetchSucceeded = !document.failureReason;
        result.checks.metadataComplete = Boolean(document.title && document.finalUrl);
        result.checks.provenanceComplete = Boolean(document.fetcherUsed && document.retrievedAt);
        if (entry.expectedFetcher) result.checks.correctFetcher = document.fetcherUsed === entry.expectedFetcher;
        if (entry.expectedStatusCode) result.checks.correctStatus = document.statusCode === entry.expectedStatusCode;
        if (entry.expectFailure !== undefined) result.checks.correctFailureState = Boolean(document.failureReason) === entry.expectFailure;
      }
    } catch (error) {
      result.errors.push(error.message);
    }
    result.passed = result.errors.length === 0 && Object.values(result.checks).every(Boolean);
    results.push(result);
  }

  const fetchCases = results.filter((entry) => entry.document);
  const percentage = (count, total) => total ? Number((count / total * 100).toFixed(1)) : null;
  return {
    runAt: new Date().toISOString(),
    caseCount: results.length,
    passed: results.filter((entry) => entry.passed).length,
    metrics: {
      passRate: percentage(results.filter((entry) => entry.passed).length, results.length),
      fetchSuccessRate: percentage(fetchCases.filter((entry) => !entry.document.failureReason).length, fetchCases.length),
      provenanceCompleteness: percentage(fetchCases.filter((entry) => entry.checks.provenanceComplete).length, fetchCases.length),
      metadataCompleteness: percentage(fetchCases.filter((entry) => entry.checks.metadataComplete).length, fetchCases.length)
    },
    results
  };
}
