/**
 * Test Rewriter Transformation
 */

import { chat } from './server/services/geminiApi.js';
import { REWRITER_PROMPT_TEMPLATE, fillTemplate } from './server/config/prompts.js';

// Copy the transformation function
function transformRewriterResponse(rawData, originalHeadline) {
    const data = rawData.data || {};
    
    const en = data.en || {};
    const titleEn = originalHeadline;
    const contentEn = [
        en.context_warming || '',
        '\n\n**Key Points:**\n' + (en.main_points || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
        '\n\n**Analysis:**\n' + (en.analysis?.impact_summary || ''),
        '\n\n**Background:**\n' + (en.background_context || '')
    ].filter(Boolean).join('\n');
    const summaryEn = en.context_warming || contentEn.substring(0, 200);
    
    const zh = data.zh_cn || {};
    const titleZh = originalHeadline;
    const contentZh = [
        zh.context_warming || '',
        '\n\n**要点：**\n' + (zh.main_points || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
        '\n\n**分析：**\n' + (zh.analysis?.impact_summary || ''),
        '\n\n**背景：**\n' + (zh.background_context || '')
    ].filter(Boolean).join('\n');
    const summaryZh = zh.context_warming || contentZh.substring(0, 200);
    
    const ms = data.ms_my || {};
    const titleMs = originalHeadline;
    const contentMs = [
        ms.context_warming || '',
        '\n\n**Perkara Utama:**\n' + (ms.main_points || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
        '\n\n**Analisis:**\n' + (ms.analysis?.impact_summary || ''),
        '\n\n**Latar Belakang:**\n' + (ms.background_context || '')
    ].filter(Boolean).join('\n');
    const summaryMs = ms.context_warming || contentMs.substring(0, 200);
    
    const tags = [];
    if (originalHeadline.toLowerCase().includes('solar')) tags.push('solar');
    if (originalHeadline.toLowerCase().includes('malaysia')) tags.push('malaysia');
    if (originalHeadline.toLowerCase().includes('energy')) tags.push('energy');
    
    return {
        title_en: titleEn,
        title_zh: titleZh,
        title_ms: titleMs,
        content_en: contentEn,
        content_zh: contentZh,
        content_ms: contentMs,
        summary_en: summaryEn,
        summary_zh: summaryZh,
        summary_ms: summaryMs,
        tags: tags.length > 0 ? tags : ['news']
    };
}

async function testTransform() {
    const REWRITER_GEMS_URL = 'https://gemini.google.com/gem/ba97012d9ebf';
    const testHeadline = 'Malaysia launches new solar initiative worth RM500 million';

    console.log('Testing rewriter transformation...\n');
    console.log('Headline:', testHeadline);
    console.log();

    const prompt = fillTemplate(REWRITER_PROMPT_TEMPLATE, {
        HEADLINE: testHeadline,
        DATE: 'November 2025',
        SEARCH_QUERY: 'Search for latest solar energy news in Malaysia'
    });

    const result = await chat(prompt, REWRITER_GEMS_URL);
    const jsonMatch = result.response.match(/\{[\s\S]*\}/);
    const rawData = JSON.parse(jsonMatch[0]);
    
    const transformed = transformRewriterResponse(rawData, testHeadline);
    
    console.log('✓ Transformation successful!\n');
    console.log('=== TRANSFORMED DATA ===\n');
    console.log('Title (EN):', transformed.title_en);
    console.log('Title (ZH):', transformed.title_zh);
    console.log('Title (MS):', transformed.title_ms);
    console.log();
    console.log('Summary (EN):', transformed.summary_en.substring(0, 150) + '...');
    console.log();
    console.log('Content (EN) length:', transformed.content_en.length, 'chars');
    console.log('Content (ZH) length:', transformed.content_zh.length, 'chars');
    console.log('Content (MS) length:', transformed.content_ms.length, 'chars');
    console.log();
    console.log('Tags:', transformed.tags);
    console.log();
    console.log('=== SAMPLE CONTENT (EN) ===');
    console.log(transformed.content_en.substring(0, 500) + '...');
}

testTransform();
