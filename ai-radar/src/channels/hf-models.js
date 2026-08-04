// Hugging Face org API — the catch-all for open-weight model drops.
//
// This is the safety net that per-repo GitHub feeds cannot provide:
// DeepSeek-V3/releases.atom will never fire for a new DeepSeek-V4 repo, and
// GitHub's org-level activity feeds return zero entries. Sorting an org's
// models by createdAt surfaces repos that did not exist yesterday.
//
// The tradeoff is noise — quantizations, forks and community re-uploads — so
// this filters to first-party org models only.
import { normalizeUrl } from '../http.js';

export const accept = 'application/json';

export function parse(body, source) {
  const models = JSON.parse(body);
  if (!Array.isArray(models)) return [];

  const org = orgFromUrl(source.url);

  return models
    .filter((model) => {
      const id = model.modelId || model.id || '';
      // First-party only: "deepseek-ai/DeepSeek-V3", not a community re-upload.
      if (org && !id.toLowerCase().startsWith(`${org.toLowerCase()}/`)) return false;
      return !isDerivative(id);
    })
    .map((model) => {
      const id = model.modelId || model.id;
      const created = model.createdAt || model.lastModified || null;
      return {
        url: normalizeUrl(`https://huggingface.co/${id}`),
        title: id,
        publishedAt: created ? new Date(created).toISOString() : null,
        summary: describe(model),
        signalType: 'model_release',
        metrics: { downloads: model.downloads ?? null, likes: model.likes ?? null }
      };
    });
}

function orgFromUrl(url) {
  try {
    return new URL(url).searchParams.get('author');
  } catch {
    return null;
  }
}

// Quantizations and format conversions are re-publications of an existing
// release, not news. The original drop is what we want to report.
function isDerivative(id) {
  return /(gguf|awq|gptq|int4|int8|fp8|bnb|mlx|onnx|-quantized|-4bit|-8bit)/i.test(id);
}

function describe(model) {
  const bits = [];
  if (model.pipeline_tag) bits.push(model.pipeline_tag);
  if (Array.isArray(model.tags)) {
    const notable = model.tags.filter((t) => /^(text-generation|vision|multimodal|moe|base|instruct)/i.test(t));
    bits.push(...notable.slice(0, 3));
  }
  if (model.downloads) bits.push(`${model.downloads.toLocaleString()} downloads`);
  return bits.join(' · ');
}
