const dashboard = document.getElementById('dashboard');
const activeJobsElement = document.getElementById('active-jobs');
const sourceListElement = document.getElementById('source-list');
const historyBody = document.getElementById('history-body');
const pipelineBody = document.getElementById('pipeline-body');
const connectionState = document.getElementById('connection-state');
const toastElement = document.getElementById('toast');
const llmBanner = document.getElementById('llm-banner');
const llmPanel = document.getElementById('llm-panel');
const llmOverall = document.getElementById('llm-overall');
const publishedNote = document.getElementById('published-note');
const sinceDateInput = document.getElementById('since-date');
const runAllButton = document.getElementById('run-all-button');
const clearSinceButton = document.getElementById('clear-since-button');
const retryFailedButton = document.getElementById('retry-failed-button');
const fixCorruptedButton = document.getElementById('fix-corrupted-button');

let pollTimer = null;
let sites = [];
let latestJobs = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message, isError = false) {
  toastElement.textContent = message;
  toastElement.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastElement.timer);
  toastElement.timer = setTimeout(() => { toastElement.className = 'toast'; }, 3200);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showDashboard() {
  if (!pollTimer) pollTimer = setInterval(refreshDashboard, 2000);
}

function timeAgo(iso) {
  if (!iso) return '-';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function duration(job) {
  const start = Date.parse(job.startedAt);
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '-';
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function timeUntil(iso) {
  if (!iso) return null;
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return 'retry due';
  if (seconds < 60) return `retry in ${seconds}s`;
  if (seconds < 3600) return `retry in ${Math.ceil(seconds / 60)}m`;
  return `retry in ${Math.ceil(seconds / 3600)}h`;
}

function transportLabel(transport) {
  if (!transport) return 'browser';
  if (typeof transport === 'string') return transport;
  const listing = transport.listing || 'browser';
  const article = transport.article || listing;
  return listing === article ? listing : `${listing} / ${article}`;
}

function renderSummary(summary = {}) {
  document.getElementById('metric-active').textContent = summary.active || 0;
  document.getElementById('metric-processes').textContent = summary.processes || 0;
  document.getElementById('metric-completed').textContent = summary.completed || 0;
  document.getElementById('metric-articles').textContent = summary.articles || 0;
  document.getElementById('metric-failed').textContent = summary.failed || 0;
}

function pipelineTotals(counts) {
  const totals = { pending: 0, done: 0, skipped: 0, failed: 0 };
  for (const row of counts || []) {
    if (row.status in totals) totals[row.status] += Number(row.count) || 0;
  }
  return totals;
}

function renderStage(stage) {
  if (!stage) return '<span class="stage-badge">not started</span>';
  const retry = timeUntil(stage.nextRetryAt);
  const meta = [
    stage.attempts ? `${stage.attempts} attempt${stage.attempts === 1 ? '' : 's'}` : null,
    retry
  ].filter(Boolean).join(' / ');
  return `
    <span class="stage-badge ${escapeHtml(stage.status)}" title="${escapeHtml(stage.lastError || '')}">${escapeHtml(stage.status)}</span>
    ${meta ? `<span class="stage-meta">${escapeHtml(meta)}</span>` : ''}
  `;
}

// Green (ok) / amber (slow, rate-limited) / red (auth_error, timeout, down).
function providerTone(state) {
  if (state === 'ok') return 'ok';
  if (state === 'slow' || state === 'rate_limited') return 'warn';
  return 'bad';
}

function providerLabel(provider) {
  switch (provider.state) {
    case 'auth_error': return 'KEY NOT WORKING';
    case 'rate_limited': return 'rate-limited';
    case 'timeout': return 'timeout';
    case 'down': return 'down';
    case 'slow': {
      const seconds = typeof provider.lastLatencyMs === 'number' ? (provider.lastLatencyMs / 1000).toFixed(1) : '?';
      return `slow (${seconds}s)`;
    }
    default: return 'ok';
  }
}

function providerReason(provider) {
  switch (provider.state) {
    case 'auth_error': return 'key returning an auth error (401/403)';
    case 'rate_limited': return 'rate-limited (429)';
    case 'timeout': return 'timing out';
    case 'down': return 'unreachable';
    case 'slow': return 'responding slowly';
    default: return 'degraded';
  }
}

function renderLlm(llm = {}) {
  const providers = llm.providers || [];
  const overall = llm.overall || 'ok';

  if (overall !== 'ok' && providers.length) {
    // Surface the most severe provider (dead key first) in the banner.
    const order = { auth_error: 0, down: 1, timeout: 2, rate_limited: 3, slow: 4 };
    const worst = [...providers]
      .filter((p) => p.state !== 'ok')
      .sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9))[0];
    if (worst) {
      llmBanner.textContent = `⚠ AI enrichment ${overall} — ${worst.name} ${providerReason(worst)}. `
        + 'Tagging/distill deferred; articles still being fetched.';
      llmBanner.hidden = false;
    } else {
      llmBanner.hidden = true;
    }
  } else {
    llmBanner.hidden = true;
  }

  llmOverall.textContent = providers.length ? `overall ${overall}` : 'no calls yet';
  llmOverall.className = providers.length ? `llm-overall ${providerTone(overall === 'down' ? 'down' : overall === 'degraded' ? 'timeout' : 'ok')}` : 'llm-overall';

  if (!providers.length) {
    llmPanel.innerHTML = '<div class="empty-state">No AI provider calls recorded yet.</div>';
    return;
  }

  llmPanel.innerHTML = providers.map((provider) => {
    const tone = providerTone(provider.state);
    const rate = typeof provider.successRate === 'number' ? `${Math.round(provider.successRate * 100)}%` : '-';
    const detail = [
      `success ${rate}`,
      provider.consecutiveFailures ? `${provider.consecutiveFailures} fail${provider.consecutiveFailures === 1 ? '' : 's'} in a row` : null,
      provider.lastError ? escapeHtml(provider.lastError) : null
    ].filter(Boolean).join(' / ');
    return `
      <div class="llm-provider ${tone}">
        <span class="llm-dot"></span>
        <div class="llm-provider-body">
          <strong>${escapeHtml(provider.name)}</strong>
          <span class="llm-state">${escapeHtml(providerLabel(provider))}</span>
        </div>
        <span class="llm-detail" title="${escapeHtml(provider.lastError || '')}">${detail}</span>
      </div>
    `;
  }).join('');
}

function renderPublishedNote(published = {}) {
  if (!publishedNote) return;
  const skipped = published.skipped;
  if (!skipped || !skipped.total) {
    publishedNote.innerHTML = `<span class="published-ok">${published.count || 0} article${(published.count || 0) === 1 ? '' : 's'} live on the news portal</span>`;
    return;
  }
  const parts = [
    skipped.staleMtime ? `${skipped.staleMtime} hidden as stale` : null,
    skipped.missingRender ? `${skipped.missingRender} awaiting render` : null,
    skipped.missingFields ? `${skipped.missingFields} missing fields` : null,
    skipped.notEnriched ? `${skipped.notEnriched} not enriched` : null,
    skipped.packetErrors ? `${skipped.packetErrors} packet errors` : null
  ].filter(Boolean).join(' / ');
  publishedNote.innerHTML = `<span class="published-ok">${published.count || 0} live</span>`
    + `<span class="published-skip">${skipped.total} not published (${escapeHtml(parts)})</span>`;
}

function renderPipeline(pipeline = {}) {
  const state = document.getElementById('pipeline-state');
  const summary = document.getElementById('pipeline-summary');
  if (!pipeline.enabled) {
    state.textContent = 'database disabled';
    summary.innerHTML = '';
    retryFailedButton.disabled = true;
    pipelineBody.innerHTML = '<tr><td colspan="7" class="mono">Configure DATABASE_URL to display pipeline state.</td></tr>';
    return;
  }
  if (pipeline.error) {
    state.textContent = 'database unavailable';
    summary.innerHTML = '';
    retryFailedButton.disabled = true;
    pipelineBody.innerHTML = `<tr><td colspan="7" class="result-failed">${escapeHtml(pipeline.error)}</td></tr>`;
    return;
  }

  const totals = pipelineTotals(pipeline.counts);
  if (!retryFailedButton.dataset.busy) retryFailedButton.disabled = !pipeline.articles || pipeline.articles.length === 0;
  summary.innerHTML = ['pending', 'failed', 'done', 'skipped'].map((status) => `
    <div class="pipeline-count ${status}">
      <span>${status} stages</span>
      <strong>${totals[status]}</strong>
    </div>
  `).join('');

  const articles = pipeline.articles || [];
  state.textContent = `${articles.length} recent article${articles.length === 1 ? '' : 's'}`;
  if (!articles.length) {
    pipelineBody.innerHTML = '<tr><td colspan="7" class="mono">No pipeline status rows recorded.</td></tr>';
    return;
  }
  pipelineBody.innerHTML = articles.map((article) => {
    const stages = article.stages || {};
    return `
      <tr>
        <td class="pipeline-article" data-label="Article">
          <strong>${escapeHtml(article.title)}</strong>
          <a href="${escapeHtml(article.url)}" target="_blank" rel="noreferrer">${escapeHtml(article.source || article.url)}</a>
        </td>
        <td class="stage-cell" data-label="Distill">${renderStage(stages.distill)}</td>
        <td class="stage-cell" data-label="Tag">${renderStage(stages.tag)}</td>
        <td class="stage-cell" data-label="Dedup">${renderStage(stages.dedup)}</td>
        <td class="stage-cell" data-label="Enrich">${renderStage(stages.enrich)}</td>
        <td class="stage-cell" data-label="Render">${renderStage(stages.render)}</td>
        <td class="mono" data-label="Updated">${timeAgo(article.pipeline_updated_at)}</td>
      </tr>
    `;
  }).join('');
}

function renderWorkers(job) {
  const workers = Object.values(job.workers || {})
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  if (!workers.length) return '<div class="worker-row"><span class="worker-state">waiting</span><div class="worker-target"><strong>No article assigned yet</strong></div></div>';
  return workers.map((worker) => `
    <div class="worker-row">
      <span class="worker-state">${escapeHtml(worker.state)}</span>
      <div class="worker-target">
        <strong>${escapeHtml(worker.title || worker.id)}</strong>
        <a href="${escapeHtml(worker.url)}" target="_blank" rel="noreferrer">${escapeHtml(worker.url)}</a>
      </div>
    </div>
  `).join('');
}

function renderActiveJobs(jobs) {
  const active = jobs.filter((job) => job.status === 'running');
  if (!active.length) {
    activeJobsElement.innerHTML = '<div class="empty-state">No active crawler jobs.</div>';
    return;
  }
  activeJobsElement.innerHTML = active.map((job) => {
    const progress = job.progress || {};
    const total = progress.candidates || progress.target || 1;
    const percent = Math.min(100, Math.round(((progress.completed || 0) / total) * 100));
    return `
      <article class="job-card">
        <div class="job-card-header">
          <div class="job-identity">
            <strong>${escapeHtml(job.source)}</strong>
            <span>${escapeHtml(job.site)} / started ${timeAgo(job.startedAt)}</span>
          </div>
          <div>
            <div class="job-stage">${escapeHtml(job.stage)}</div>
            <div class="job-process">PID ${escapeHtml(job.pid)}</div>
          </div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        <div class="job-stats">
          <div class="job-stat"><span>Candidates</span><strong>${progress.candidates || 0}</strong></div>
          <div class="job-stat"><span>Processed</span><strong>${progress.completed || 0}</strong></div>
          <div class="job-stat"><span>Valid</span><strong>${progress.succeeded || 0}/${progress.target ?? '∞'}</strong></div>
          <div class="job-stat"><span>Elapsed</span><strong>${duration(job)}</strong></div>
        </div>
        <div class="worker-list">${renderWorkers(job)}</div>
      </article>
    `;
  }).join('');
}

function renderSources() {
  const activeSites = new Set(latestJobs.filter((job) => job.status === 'running').map((job) => job.site));
  document.getElementById('source-count').textContent = `${sites.length} source${sites.length === 1 ? '' : 's'}`;
  sourceListElement.innerHTML = sites.map((site) => {
    const busy = site.busy || activeSites.has(site.id);
    return `
      <div class="source-row">
        <div class="source-name"><strong>${escapeHtml(site.source)}</strong><span>${escapeHtml(site.id)} / ${escapeHtml(site.country)}</span></div>
        <span class="source-meta">${escapeHtml(transportLabel(site.transport))}</span>
        <span class="source-meta">target ${escapeHtml(site.articleLimit)}</span>
        <span class="status-pill ${busy ? 'running' : ''}">${busy ? 'running' : 'ready'}</span>
        <button class="run-button" data-run-site="${escapeHtml(site.id)}" ${busy ? 'disabled' : ''}>${busy ? 'Busy' : 'Run'}</button>
      </div>
    `;
  }).join('');
}

function renderHistory(jobs) {
  if (!jobs.length) {
    historyBody.innerHTML = '<tr><td colspan="6" class="mono">No crawl runs recorded.</td></tr>';
    return;
  }
  historyBody.innerHTML = jobs.slice(0, 30).map((job) => {
    const result = job.result
      ? `${job.result.count}/${job.result.requested ?? '∞'} saved`
      : job.error?.message || job.message || '-';
    return `
      <tr>
        <td class="result-${escapeHtml(job.status)}" data-label="Status">${escapeHtml(job.status)}</td>
        <td data-label="Source"><strong>${escapeHtml(job.source)}</strong><br><span class="mono">${escapeHtml(job.site)}</span></td>
        <td class="mono" data-label="Started">${timeAgo(job.startedAt)}</td>
        <td class="mono" data-label="Duration">${duration(job)}</td>
        <td data-label="Result">${escapeHtml(result)}</td>
        <td class="mono" data-label="Process">${escapeHtml(job.pid)}</td>
      </tr>
    `;
  }).join('');
}

async function refreshDashboard() {
  try {
    const [statusData, siteData] = await Promise.all([
      api('/api/factory/status'),
      api('/api/factory/sites')
    ]);
    latestJobs = statusData.jobs || [];
    sites = siteData.sites || [];
    renderSummary(statusData.summary);
    renderLlm(statusData.llm);
    renderActiveJobs(latestJobs);
    renderPipeline(statusData.pipeline);
    renderPublishedNote(statusData.published);
    renderSources();
    renderHistory(latestJobs);
    document.getElementById('last-updated').textContent = `Updated ${timeAgo(statusData.generatedAt)}`;
    connectionState.textContent = 'live / 2s';
    connectionState.className = 'connection-state online';
  } catch (error) {
    if (!dashboard.hidden) {
      connectionState.textContent = 'offline';
      connectionState.className = 'connection-state offline';
      console.error(error);
    }
  }
}

document.getElementById('refresh-button').addEventListener('click', refreshDashboard);

sourceListElement.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-run-site]');
  if (!button) return;
  const id = button.dataset.runSite;
  const since = sinceDateInput.value || null;
  button.disabled = true;
  button.textContent = 'Starting';
  try {
    await api(`/api/factory/sites/${encodeURIComponent(id)}/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since })
    });
    toast(since ? `Started ${id} (since ${since})` : `Started ${id}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await refreshDashboard();
  } catch (error) {
    toast(error.message, true);
    await refreshDashboard();
  }
});

runAllButton.addEventListener('click', async () => {
  const since = sinceDateInput.value;
  if (!since) {
    toast('Pick a date first', true);
    return;
  }
  runAllButton.disabled = true;
  runAllButton.textContent = 'Starting';
  try {
    const result = await api('/api/factory/sites/fetch-all', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since })
    });
    const busyNote = result.busy?.length ? `, ${result.busy.length} already running` : '';
    toast(`Started ${result.dispatched.length} source(s) since ${since}${busyNote}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await refreshDashboard();
  } catch (error) {
    toast(error.message, true);
  } finally {
    runAllButton.disabled = false;
    runAllButton.textContent = 'Run all since date';
  }
});

clearSinceButton.addEventListener('click', () => {
  sinceDateInput.value = '';
});

retryFailedButton.addEventListener('click', async () => {
  retryFailedButton.dataset.busy = '1';
  retryFailedButton.disabled = true;
  const label = retryFailedButton.textContent;
  retryFailedButton.textContent = 'Retrying';
  try {
    const result = await api('/api/factory/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    toast(result.attempted
      ? `Retried ${result.attempted}: ${result.succeeded} recovered, ${result.failed} still failing`
      : 'No failed stages ready to retry');
    await refreshDashboard();
  } catch (error) {
    toast(error.message, true);
  } finally {
    delete retryFailedButton.dataset.busy;
    retryFailedButton.textContent = label;
    await refreshDashboard();
  }
});

if (fixCorruptedButton) {
  fixCorruptedButton.addEventListener('click', async () => {
    fixCorruptedButton.disabled = true;
    const label = fixCorruptedButton.textContent;
    fixCorruptedButton.textContent = 'Fixing (AGY)...';
    try {
      const result = await api('/api/factory/fix-corrupted', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'Gemini 3.6 Flash (Low)' })
      });
      toast(result.processed?.length
        ? `Refilled ${result.processed.length} file(s) via AGY (${result.model})`
        : 'No corrupted files detected!');
      await refreshDashboard();
    } catch (error) {
      toast(error.message, true);
    } finally {
      fixCorruptedButton.disabled = false;
      fixCorruptedButton.textContent = label;
      await refreshDashboard();
    }
  });
}

// ---------------------------------------------------------------------------
// LLM control plane: providers, models, and the ordered fallback chain per task.
//
// Deliberately NOT part of refreshDashboard's 2s poll — re-rendering this while
// the operator is typing a key or reordering a chain would wipe their input.
// It loads on boot and re-loads only after a write.
// ---------------------------------------------------------------------------
const llmConfigState = document.getElementById('llm-config-state');
const llmProviderForm = document.getElementById('llm-provider-form');
const llmProviderList = document.getElementById('llm-provider-list');
const llmRoutesElement = document.getElementById('llm-routes');

let llmConfig = { enabled: false, tasks: [], providers: [], routes: {} };
let editingProviderId = null;

/** Flat list of every enabled model, used to populate the chain pickers. */
function modelOptions() {
  const out = [];
  for (const provider of llmConfig.providers) {
    if (!provider.enabled) continue;
    for (const model of provider.models) {
      if (!model.enabled) continue;
      out.push({ id: model.id, text: `${provider.name} / ${model.model}`, apiStyle: provider.apiStyle });
    }
  }
  return out;
}

function renderLlmProviders() {
  if (!llmConfig.providers.length) {
    llmProviderList.innerHTML = '<div class="empty-state">No providers configured — the built-in env chains are in use.</div>';
    return;
  }
  llmProviderList.innerHTML = llmConfig.providers.map((provider) => {
    const models = provider.models.length
      ? provider.models.map((model) => `
          <li>
            <code>${escapeHtml(model.model)}</code>
            <button type="button" class="link-button" data-llm-test="${provider.id}" data-model="${escapeHtml(model.model)}">test</button>
            <button type="button" class="link-button danger" data-llm-del-model="${model.id}">remove</button>
          </li>`).join('')
      : '<li class="muted">no models yet</li>';

    if (provider.id === editingProviderId) {
      return `
        <article class="llm-cfg-card">
          <form class="llm-provider-form" data-llm-edit-form="${provider.id}">
            <div class="llm-field"><label>Name</label>
              <input name="name" value="${escapeHtml(provider.name)}" required /></div>
            <div class="llm-field"><label>API style</label>
              <select name="apiStyle">
                <option value="anthropic"${provider.apiStyle === 'anthropic' ? ' selected' : ''}>anthropic — /v1/messages</option>
                <option value="openai"${provider.apiStyle === 'openai' ? ' selected' : ''}>openai — /v1/chat/completions</option>
              </select></div>
            <div class="llm-field llm-field-wide"><label>Base URL</label>
              <input name="baseUrl" value="${escapeHtml(provider.baseUrl)}" required /></div>
            <div class="llm-field llm-field-wide"><label>API key</label>
              <input name="apiKey" type="password" autocomplete="off" placeholder="leave blank to keep current key" /></div>
            <button type="submit" class="run-button">Save changes</button>
            <button type="button" class="link-button" data-llm-cancel-edit>cancel</button>
          </form>
        </article>`;
    }

    return `
      <article class="llm-cfg-card${provider.enabled ? '' : ' disabled'}">
        <header>
          <strong>${escapeHtml(provider.name)}</strong>
          <span class="pill">${escapeHtml(provider.apiStyle)}</span>
          <button type="button" class="link-button" data-llm-edit="${provider.id}">edit</button>
          <button type="button" class="link-button" data-llm-toggle="${provider.id}" data-enabled="${provider.enabled}">${provider.enabled ? 'disable' : 'enable'}</button>
          <button type="button" class="link-button danger" data-llm-del-provider="${provider.id}">delete</button>
        </header>
        <div class="llm-cfg-meta">
          <span>${escapeHtml(provider.baseUrl)}</span>
          <span class="muted">key ${escapeHtml(provider.apiKeyMasked)}</span>
        </div>
        <ul class="llm-model-list">${models}</ul>
        <form class="llm-add-model" data-llm-add-model="${provider.id}">
          <input name="model" placeholder="model id" required />
          <button type="submit" class="link-button">add model</button>
        </form>
      </article>`;
  }).join('');
}

function renderLlmRoutes() {
  const options = modelOptions();
  llmRoutesElement.innerHTML = llmConfig.tasks.map((task) => {
    const chain = llmConfig.routes[task] || [];
    // One row per chain position, plus a trailing empty row to append with.
    const rows = [...chain.map((entry) => entry.modelId), null].map((selected, index) => {
      const opts = ['<option value="">— none —</option>']
        .concat(options.map((option) =>
          `<option value="${option.id}"${option.id === selected ? ' selected' : ''}>${escapeHtml(option.text)}</option>`));
      // Enrichment streams SSE against the Anthropic messages shape, so an
      // openai-style entry there is skipped at runtime. Say so up front.
      const chosen = options.find((option) => option.id === selected);
      const warn = task === 'enrich' && chosen && chosen.apiStyle !== 'anthropic'
        ? '<span class="llm-warn" title="Enrichment requires an Anthropic-style endpoint; this entry is skipped at runtime.">unsupported for enrich</span>'
        : '';
      return `<div class="llm-route-row"><span class="llm-route-index">${index + 1}</span>
        <select data-llm-route="${task}" data-index="${index}">${opts.join('')}</select>${warn}</div>`;
    }).join('');
    return `<div class="llm-route-task"><h4>${escapeHtml(task)}</h4>${rows}
      <button type="button" class="run-button" data-llm-save-route="${task}">Save ${escapeHtml(task)} chain</button></div>`;
  }).join('');
}

/** Read the current chain straight off the DOM selects, in display order. */
function chainFromDom(task) {
  return [...llmRoutesElement.querySelectorAll(`select[data-llm-route="${task}"]`)]
    .map((select) => Number(select.value))
    .filter(Boolean)
    .map((modelId) => ({ modelId, enabled: true }));
}

async function loadLlmConfig() {
  try {
    const data = await api('/api/factory/llm');
    llmConfig = data;
    llmConfigState.textContent = data.enabled ? `${data.providers.length} provider(s)` : (data.error || 'database required');
    if (!data.enabled) {
      llmProviderList.innerHTML = `<div class="empty-state">${escapeHtml(data.error || 'Database required')}</div>`;
      llmRoutesElement.innerHTML = '';
      return;
    }
    renderLlmProviders();
    renderLlmRoutes();
  } catch (error) {
    llmConfigState.textContent = 'error';
    console.error(error);
  }
}

llmProviderForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(llmProviderForm);
  const models = String(form.get('models') || '').split(',').map((m) => m.trim()).filter(Boolean);
  try {
    await api('/api/factory/llm/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        apiStyle: form.get('apiStyle'),
        baseUrl: form.get('baseUrl'),
        apiKey: form.get('apiKey'),
        models
      })
    });
    llmProviderForm.reset();
    toast('Provider added');
    await loadLlmConfig();
  } catch (error) {
    toast(error.message, true);
  }
});

llmProviderList.addEventListener('submit', async (event) => {
  const editProviderId = event.target.dataset?.llmEditForm;
  if (editProviderId) {
    event.preventDefault();
    const form = new FormData(event.target);
    const apiKey = String(form.get('apiKey') || '').trim();
    const patch = {
      name: form.get('name'),
      apiStyle: form.get('apiStyle'),
      baseUrl: form.get('baseUrl')
    };
    if (apiKey) patch.apiKey = apiKey; // blank means "keep the existing key"
    try {
      await api(`/api/factory/llm/providers/${editProviderId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch)
      });
      editingProviderId = null;
      toast('Provider updated');
      await loadLlmConfig();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const providerId = event.target.dataset?.llmAddModel;
  if (!providerId) return;
  event.preventDefault();
  const model = new FormData(event.target).get('model');
  try {
    await api(`/api/factory/llm/providers/${providerId}/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model })
    });
    toast('Model added');
    await loadLlmConfig();
  } catch (error) {
    toast(error.message, true);
  }
});

llmProviderList.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const { llmTest, llmDelModel, llmDelProvider, llmToggle, llmEdit, llmCancelEdit } = button.dataset;
  if (llmEdit !== undefined) {
    editingProviderId = Number(llmEdit);
    renderLlmProviders();
    return;
  }
  if (llmCancelEdit !== undefined) {
    editingProviderId = null;
    renderLlmProviders();
    return;
  }
  try {
    if (llmTest) {
      button.disabled = true;
      button.textContent = 'testing...';
      const result = await api('/api/factory/llm/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: Number(llmTest), model: button.dataset.model })
      });
      button.disabled = false;
      button.textContent = 'test';
      toast(result.ok ? `OK in ${result.latencyMs}ms — "${result.reply}"` : `Failed: ${result.error}`, !result.ok);
      return;
    }
    if (llmDelModel) {
      await api(`/api/factory/llm/models/${llmDelModel}`, { method: 'DELETE' });
      toast('Model removed');
    } else if (llmDelProvider) {
      if (!confirm('Delete this provider, its models, and any task routes using them?')) return;
      await api(`/api/factory/llm/providers/${llmDelProvider}`, { method: 'DELETE' });
      toast('Provider deleted');
    } else if (llmToggle) {
      await api(`/api/factory/llm/providers/${llmToggle}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: button.dataset.enabled !== 'true' })
      });
      toast('Provider updated');
    } else {
      return;
    }
    await loadLlmConfig();
  } catch (error) {
    button.disabled = false;
    toast(error.message, true);
  }
});

llmRoutesElement.addEventListener('change', (event) => {
  // Re-render so choosing a model in the trailing row grows a new empty row and
  // the enrich-compatibility warning updates immediately.
  const task = event.target.dataset?.llmRoute;
  if (!task) return;
  llmConfig.routes[task] = chainFromDom(task);
  renderLlmRoutes();
});

llmRoutesElement.addEventListener('click', async (event) => {
  const task = event.target.closest('button')?.dataset?.llmSaveRoute;
  if (!task) return;
  const entries = chainFromDom(task);
  try {
    await api(`/api/factory/llm/routes/${task}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries })
    });
    toast(entries.length ? `${task}: ${entries.length} model(s) in chain` : `${task}: cleared — built-in chain will be used`);
    await loadLlmConfig();
  } catch (error) {
    toast(error.message, true);
  }
});

(async function boot() {
  showDashboard();
  await refreshDashboard();
  await loadLlmConfig();
})();
