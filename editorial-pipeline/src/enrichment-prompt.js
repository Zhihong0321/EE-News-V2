export const enrichmentRelationships = new Set([
  'historical-context',
  'comparison',
  'cause',
  'consequence',
  'stakeholder-impact',
  'contradiction',
  'future-signal'
]);

// Signal-Style soft budgets. EN measured in words, ZH in characters.
// Overflow produces warnings only (never blocks) per the agreed spec.
export const styleBudgets = {
  displayTitle: { en: 12, zh: 20 },
  summary: { en: 40, zh: 70 },
  keyFact: { en: 20, zh: 35 },
  insight: { en: 30, zh: 50 },
  keyTakeaway: { en: 25, zh: 45 },
  watchItem: { en: 15, zh: 28 },
  uncertainty: { en: 15, zh: 28 },
  timelineEvent: { en: 12, zh: 22 }
};

export function articleCutoffDate(article) {
  const parsed = new Date(article.published_at);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return String(article.published_at || '').slice(0, 10);
}

export function buildEnrichmentPrompt(article) {
  const cutoff = articleCutoffDate(article);
  return `You are a research editor preparing bilingual content for a multi-dimensional news infographic.

CORE NEWS
Title: ${article.title}
Publisher: ${article.source}
Author: ${article.author || 'Unknown'}
Published date: ${article.published_at}
Source URL: ${article.url}
Section: ${article.section || 'Unknown'}
Article text:
${article.body}

OBJECTIVE
Prepare concise, evidence-based content for a multi-dimensional infographic centered on the Core News.

LANGUAGE (MANDATORY)
- The source article may be in ANY language (Japanese, Korean, Indonesian, Chinese, English, etc.).
- Every human-readable text field MUST be produced in BOTH English (en) and Simplified Chinese (zh),
  regardless of the source language. Never leave either language empty.
- Chinese register: Mainland Simplified, neutral wire-service tone (concise, factual, like 新华社/财新).
- Proper nouns: Japanese names keep kanji in zh, Hepburn romanization in en; Korean names use the
  standard Chinese rendering in zh, Revised Romanization in en; companies/places use their official
  en and zh forms.
- NUMERAL SCALE (critical): reason in base numbers. English "billion" = 10^9; Chinese 亿 = 10^8, 万 = 10^4.
  Example: "20.9 billion" -> "209亿" (NOT "20.9亿"). Keep numeric \`value\` fields as the raw base number;
  only the unit label carries the scale word.

GEOGRAPHIC NEUTRALITY (MANDATORY)
- The audience is international; the source's home country is NOT the reader's home country.
- Resolve every first-person or source-relative place reference to an explicit, named place in BOTH languages.
  Never carry over deictic terms that only make sense from the source's viewpoint. Examples of terms to replace:
    zh: 我国 / 本国 / 我省 / 我市 / 我区 / 祖国 / 我们国家  ->  名字 (e.g. 中国 / 日本 / 韩国)
    ja: 我が国 / わが国 / 国内  ->  the named country
    ko: 우리나라 / 국내  ->  the named country
    en: "our country" / "the nation" / "the motherland" / "here at home"  ->  "China" / "Japan" / etc.
- Infer the referent from the Publisher and article context (e.g. a 新华社 article's 我国 = 中国).
- Apply the same rule to sub-national deixis (本市/本省/"our state") and to relative time-of-writing phrasing
  ("current government", "this year") when the concrete named place / absolute date is knowable.

SIGNAL STYLE (writing contract — the opposite of long-form journalism)
- Fact first, framing never. No openers like "In a move that", "It comes amid", "Against the backdrop of".
- One idea per sentence. Subject-verb-object. Active voice. Declarative.
- Numbers over adjectives. Concrete figures beat descriptive words.
- No nanny phrases: "it's important to note", "experts say", "many believe", "arguably", "notably".
- No restating: the summary must NOT paraphrase the title; every field adds new information.
- Neutral. No editorializing adjectives, no verdicts. State, do not judge.
- Cut: hedges, adverbs, "in order to", redundant attribution, scene-setting, metacommentary.
- Chinese: 书面简体, 去「的的不休」与冗余「了/进行」, 偏短句与四字, 半角数字+全角标点, 不照搬英文语序.
- Soft length targets (aim for, do not pad to reach): displayTitle <=12 words / <=20字;
  summary <=40 words / <=70字; each keyFact <=20 words / <=35字; insight <=30 words / <=50字;
  keyTakeaway <=25 words / <=45字; each whatToWatch & uncertainty <=15 words / <=28字;
  each timeline event <=12 words / <=22字.

YOUR SCOPE
- Preserve the Core News and its essential facts.
- Research directly related supporting information using web search.
- Add useful context, comparisons, timelines, statistics, causes, consequences, counterpoints, future signals.
- Produce slide-ready bilingual text and structured numerical data.
- Include source citations for every supporting claim.

NOT YOUR SCOPE
- Do not create HTML, CSS, visual layouts, or finished infographic designs.
- Do not replace the Core News with a different story.
- Do not write a conventional long-form article.
- Do not add unrelated information merely because it concerns the same industry or country.

EDITORIAL RULES
1. Keep the Core News intact and clearly separate it from enrichment.
2. Every supporting item must use one relationship:
   historical-context, comparison, cause, consequence, stakeholder-impact, contradiction, or future-signal.
3. Do not claim causation unless reliable sources explicitly support it.
4. Distinguish verified facts, reported claims, analysis, and uncertainty.
5. Use absolute dates and identify the period represented by every number.
6. Compare equivalent measurements. Do not compare incompatible statistics.
7. Prefer primary sources, official data, and reputable reporting.
8. If reliable supporting evidence is unavailable, omit the dimension.
9. Keep text concise and suitable for infographic panels.
10. Never use search snippets as final evidence without inspecting the source.
11. Treat ${cutoff} as the research cutoff. Do not include information published after that date.
12. Preserve "originalTitle" and "sourceUrl" EXACTLY as given (originalTitle stays in the source language).
13. Return valid JSON only, with no Markdown fences or introductory prose.

Every field shown below as { "en": "", "zh": "" } is a bilingual pair and BOTH must be filled.
All other fields (numbers, dates, ids, urls, enums) are shared and appear once.

OUTPUT SCHEMA
{
  "coreNews": {
    "originalTitle": "${article.title.replace(/"/g, '\\"')}",
    "displayTitle": { "en": "", "zh": "" },
    "publisher": "",
    "publishedAt": "",
    "sourceUrl": "${article.url}",
    "summary": { "en": "", "zh": "" },
    "keyFacts": [
      { "text": { "en": "", "zh": "" }, "sourceId": "core" }
    ]
  },
  "centralInsight": { "en": "", "zh": "" },
  "dimensions": [
    {
      "title": { "en": "", "zh": "" },
      "relationship": "historical-context|comparison|cause|consequence|stakeholder-impact|contradiction|future-signal",
      "insight": { "en": "", "zh": "" },
      "supportingFacts": [
        {
          "text": { "en": "", "zh": "" },
          "sourceId": "",
          "confidence": "high|medium|low"
        }
      ],
      "metrics": [
        {
          "label": { "en": "", "zh": "" },
          "value": null,
          "unit": { "en": "", "zh": "" },
          "period": { "en": "", "zh": "" },
          "comparisonValue": null,
          "comparisonPeriod": { "en": "", "zh": "" },
          "sourceId": ""
        }
      ],
      "suggestedPresentation": "number|comparison|timeline|chart|map|quote|text"
    }
  ],
  "timeline": [
    { "date": "", "event": { "en": "", "zh": "" }, "sourceId": "" }
  ],
  "keyTakeaway": { "en": "", "zh": "" },
  "whatToWatch": [ { "en": "", "zh": "" } ],
  "uncertainties": [ { "en": "", "zh": "" } ],
  "sources": [
    {
      "id": "",
      "title": { "en": "", "zh": "" },
      "publisher": "",
      "publishedAt": "",
      "url": ""
    }
  ]
}`;
}
