import asyncio
import json
import sys


def markdown_text(value):
    if isinstance(value, str):
        return value
    return (
        getattr(value, "fit_markdown", None)
        or getattr(value, "raw_markdown", None)
        or str(value or "")
    )


async def fetch_page(url):
    try:
        from crawl4ai import AsyncWebCrawler, CacheMode, CrawlerRunConfig
    except ImportError as error:
        raise RuntimeError(
            "Crawl4AI is not installed. Run: python -m pip install -r "
            "editorial-pipeline/requirements.txt"
        ) from error

    config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS)
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url, config=config)

    metadata = getattr(result, "metadata", None) or {}
    status_code = getattr(result, "status_code", None)
    final_url = (
        getattr(result, "redirected_url", None)
        or getattr(result, "url", None)
        or url
    )
    return {
        "success": bool(getattr(result, "success", False)),
        "url": url,
        "finalUrl": final_url,
        "statusCode": status_code,
        "title": metadata.get("title", ""),
        "publishedAt": (
            metadata.get("datePublished")
            or metadata.get("published_time")
            or metadata.get("article:published_time")
        ),
        "author": metadata.get("author", ""),
        "publisher": metadata.get("site_name", ""),
        "markdown": markdown_text(getattr(result, "markdown", "")),
        "metadata": metadata,
        "links": getattr(result, "links", None) or {},
        "error": getattr(result, "error_message", None),
    }


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: crawl4ai_fetch.py <url>")
    print(json.dumps(asyncio.run(fetch_page(sys.argv[1])), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
