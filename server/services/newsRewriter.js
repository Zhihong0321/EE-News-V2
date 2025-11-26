/**
 * News Rewriter Service
 * Processes headlines and creates full articles with translations
 */

import { query } from '../db.js';
import { chat } from './geminiApi.js';
import { REWRITER_PROMPT_TEMPLATE, fillTemplate } from '../config/prompts.js';

// Default GEMS URL for rewriter (can be overridden)
const REWRITER_GEMS_URL = 'https://gemini.google.com/gem/ba97012d9ebf';

/**
 * Transform rewriter GEMS response to database format
 * @param {Object} rawData - Raw response from rewriter GEMS
 * @param {string} originalHeadline - Original headline
 * @returns {Object} Transformed article data
 */
function transformRewriterResponse(rawData, originalHeadline) {
    const data = rawData.data || {};
    
    // Extract English content
    const en = data.en || {};
    const titleEn = originalHeadline; // Use original headline as title
    const contentEn = [
        en.context_warming || '',
        '\n\n**Key Points:**\n' + (en.main_points || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
        '\n\n**Analysis:**\n' + (en.analysis?.impact_summary || ''),
        '\n\n**Background:**\n' + (en.background_context || '')
    ].filter(Boolean).join('\n');
    const summaryEn = en.context_warming || contentEn.substring(0, 200);
    
    // Extract Chinese content
    const zh = data.zh_cn || {};
    const titleZh = originalHeadline; // Could translate if needed
    const contentZh = [
        zh.context_warming || '',
        '\n\n**要点：**\n' + (zh.main_points || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
        '\n\n**分析：**\n' + (zh.analysis?.impact_summary || ''),
        '\n\n**背景：**\n' + (zh.background_context || '')
    ].filter(Boolean).join('\n');
    const summaryZh = zh.context_warming || contentZh.substring(0, 200);
    
    // Extract Malay content
    const ms = data.ms_my || {};
    const titleMs = originalHeadline; // Could translate if needed
    const contentMs = [
        ms.context_warming || '',
        '\n\n**Perkara Utama:**\n' + (ms.main_points || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
        '\n\n**Analisis:**\n' + (ms.analysis?.impact_summary || ''),
        '\n\n**Latar Belakang:**\n' + (ms.background_context || '')
    ].filter(Boolean).join('\n');
    const summaryMs = ms.context_warming || contentMs.substring(0, 200);
    
    // Extract tags from analysis or generate from content
    const tags = [];
    if (originalHeadline.toLowerCase().includes('solar')) tags.push('solar');
    if (originalHeadline.toLowerCase().includes('malaysia')) tags.push('malaysia');
    if (originalHeadline.toLowerCase().includes('energy')) tags.push('energy');
    if (en.analysis?.affected_stakeholders) tags.push('business');
    
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

/**
 * Rewrite a single headline into a full article
 * @param {number} headlineId - Headline ID
 * @returns {Promise<{success: boolean, article: Object}>}
 */
export async function rewriteHeadline(headlineId) {
    try {
        // Get headline details
        const headlineResult = await query(
            'SELECT * FROM app_news_headlines WHERE id = $1',
            [headlineId]
        );

        if (headlineResult.rows.length === 0) {
            return { success: false, error: 'Headline not found' };
        }

        const headline = headlineResult.rows[0];

        // Update status to processing
        await query(
            'UPDATE app_news_headlines SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['processing', headlineId]
        );

        // Prepare prompt
        const prompt = fillTemplate(REWRITER_PROMPT_TEMPLATE, {
            HEADLINE: headline.headline,
            DATE: headline.news_date || 'Recent',
            SEARCH_QUERY: headline.search_query || ''
        });

        // Call Gemini GEMS
        const chatResult = await chat(prompt, REWRITER_GEMS_URL);

        if (!chatResult.success) {
            throw new Error('Chat failed');
        }

        // Parse response
        let rawData;
        try {
            // Extract JSON from response
            const jsonMatch = chatResult.response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                rawData = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            console.error('Failed to parse rewriter response:', parseError);
            throw new Error('Failed to parse response');
        }

        // Transform the rewriter GEMS format to our database format
        const articleData = transformRewriterResponse(rawData, headline.headline);

        // Store article in database
        const articleResult = await query(
            `INSERT INTO app_news_articles 
            (headline_id, title_en, title_zh, title_ms, content_en, content_zh, content_ms, 
             summary_en, summary_zh, summary_ms, tags)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [
                headlineId,
                articleData.title_en,
                articleData.title_zh || null,
                articleData.title_ms || null,
                articleData.content_en,
                articleData.content_zh || null,
                articleData.content_ms || null,
                articleData.summary_en,
                articleData.summary_zh || null,
                articleData.summary_ms || null,
                articleData.tags || []
            ]
        );

        // Update headline status to completed
        await query(
            'UPDATE app_news_headlines SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['completed', headlineId]
        );

        return {
            success: true,
            article: articleResult.rows[0]
        };
    } catch (error) {
        console.error('rewriteHeadline error:', error);

        // Update headline status to failed
        await query(
            `UPDATE app_news_headlines 
            SET status = $1, error_message = $2, retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $3`,
            ['failed', error.message, headlineId]
        );

        return { success: false, error: error.message };
    }
}

/**
 * Process next N fresh headlines
 * @param {number} limit - Number of headlines to process (default: 5)
 * @param {number} taskId - Optional task ID to filter headlines
 * @returns {Promise<{success: boolean, processed: number, failed: number, results: Array}>}
 */
export async function processNextHeadlines(limit = 5, taskId = null) {
    try {
        // Get fresh headlines
        let queryText = `SELECT id, headline FROM app_news_headlines 
            WHERE status = 'fresh'`;
        const queryParams = [];
        
        if (taskId) {
            queryText += ` AND task_id = $1`;
            queryParams.push(taskId);
            queryText += ` ORDER BY created_at ASC LIMIT $2`;
            queryParams.push(limit);
        } else {
            queryText += ` ORDER BY created_at ASC LIMIT $1`;
            queryParams.push(limit);
        }

        const headlinesResult = await query(queryText, queryParams);

        let processed = 0;
        let failed = 0;
        const results = [];

        for (const headline of headlinesResult.rows) {
            const result = await rewriteHeadline(headline.id);
            
            results.push({
                headline: headline.headline,
                status: result.success ? 'completed' : 'failed',
                error: result.error || null
            });
            
            if (result.success) {
                processed++;
            } else {
                failed++;
            }
        }

        return {
            success: true,
            processed,
            failed,
            total: headlinesResult.rows.length,
            results
        };
    } catch (error) {
        console.error('processNextHeadlines error:', error);
        return { 
            success: false, 
            error: error.message, 
            processed: 0, 
            failed: 0,
            results: []
        };
    }
}
