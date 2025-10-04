// promptflow.js — v16: template-only input; data matrix auto; waits for preprocessed-ready
'use strict';
import dataStore from './dataStore.js';

const ENCODER_URL = 'https://api.exolix.club/encode';
console.log('[promptflow] v16 USING', ENCODER_URL, 'from', import.meta.url);

const $ = (id) => document.getElementById(id);
const show = (n) => n && n.classList.remove('hidden');
const hide = (n) => n && n.classList.add('hidden');

// ---------------- Helpers ----------------
function normalizeMapping(maybeWrapped) {
  return (maybeWrapped && maybeWrapped.mapping) ? maybeWrapped.mapping : maybeWrapped || null;
}
function formatWithIndexPlaceholders(template, vector) {
  return template.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, idx) => {
    const i = Number(idx);
    if (!Array.isArray(vector) || i < 0 || i >= vector.length) return 'unknown';
    const v = vector[i];
    return (v === undefined || v === null || v === '') ? 'unknown' : String(v);
  });
}
function extractIndices(template) {
  const s = new Set(); let m; const re = /\{\{\s*(\d+)\s*\}\}/g;
  while ((m = re.exec(template))) s.add(Number(m[1]));
  return Array.from(s).sort((a, b) => a - b);
}
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const is2D = (arr) => Array.isArray(arr) && arr.length > 0 && Array.isArray(arr[0]);

function buildDefaultTemplate(featureCount) {
  if (!featureCount) return 'I have data with feature {{0}}.';
  const parts = Array.from({ length: featureCount }, (_, i) => `feature ${i} {{${i}}}`);
  return `I have this exoplanet data with ${parts.join(', ')}. Classify as CANDIDATE or FALSE POSITIVE. Return only the label.`;
}

// ---------------- Results UI ----------------
function ensureResultsUI() {
  let r = $('pbResults');
  if (r) return r;
  const card = $('promptBuilderCard');
  r = document.createElement('div');
  r.id = 'pbResults';
  r.className = 'mt-6 hidden';
  r.innerHTML = `
    <h3 class="text-lg font-semibold text-white mb-2">Results</h3>
    <div class="text-sm text-gray-300 border border-gray-800 bg-gray-900 rounded p-3">
      <div id="pbResultSummary" class="mb-2"></div>
      <pre id="pbResultPreview" class="text-gray-200 whitespace-pre-wrap"></pre>
    </div>
  `;
  card.appendChild(r);
  return r;
}
function showEmbeddingSummary(payload) {
  const r = ensureResultsUI();
  const sum = $('pbResultSummary');
  const pre = $('pbResultPreview');

  let summary = 'ℹ️ Response received.';
  let preview = '';

  const emb = payload && payload.embedding;
  if (Array.isArray(emb) && Array.isArray(emb[0])) {
    const rows = emb.length;
    const cols = emb[0].length;
    summary = `✅ Received embedding: ${rows} × ${cols}`;
    const firstRow = emb[0].slice(0, Math.min(8, cols));
    preview = `First row (first ${firstRow.length} values):\n` +
      firstRow.map(v => (typeof v === 'number' ? v.toFixed(4) : String(v))).join(', ');
  } else if (payload && (payload.result || payload.label)) {
    summary = `✅ Result: ${payload.result || payload.label}`;
  } else {
    preview = JSON.stringify(payload, null, 2);
  }

  sum.textContent = summary;
  pre.textContent = preview;
  show(r);
}
function notifyResponse(payload) {
  document.dispatchEvent(new CustomEvent('promptflow:response', { detail: payload }));
  if (typeof window.onPromptflowResponse === 'function') {
    try { window.onPromptflowResponse(payload); } catch {}
  }
}

// ---------------- Progress ----------------
function createProgress() {
  const wrap = $('pbProgressWrap');
  const fill = $('pbProgFill');
  const label = $('pbProgLabel');
  const etaEl = $('pbProgTime');
  let start = 0, duration = 14000, rafId = null;
  function set(p, txt, etaSec) {
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, p))}%`;
    if (txt && label) label.textContent = txt;
    if (etaEl && etaSec != null) etaEl.textContent = `${Math.ceil(etaSec)}s`;
  }
  function begin(ms = 14000) {
    show(wrap);
    start = performance.now();
    duration = Math.max(1200, ms);
    const tick = () => {
      const t = performance.now() - start;
      const p = Math.min(100, (t / duration) * 100);
      set(p, 'Sending…', Math.max(0, (duration - t) / 1000));
      if (p < 100) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  function done(msg = 'Completed') {
    if (rafId) cancelAnimationFrame(rafId);
    set(100, msg, 0);
    setTimeout(() => hide(wrap), 800);
  }
  function fail(msg = 'Failed') {
    if (rafId) cancelAnimationFrame(rafId);
    if (label) label.textContent = msg;
    if (fill) { fill.style.width = '100%'; fill.classList.remove('bg-blue-500'); fill.classList.add('bg-red-500'); }
    if (etaEl) etaEl.textContent = '';
  }
  return { begin, done, fail };
}

// ---------------- State ----------------
let mapping = null;
let featureCount = 0;
let matrix = []; // samples × features

function getMatrixFromTraining() {
  try { const m = window.getMappedFeatureMatrix?.(); return is2D(m) ? m : []; }
  catch { return []; }
}

// ---------------- UI helpers ----------------
function renderInfoLine() {
  const fields = $('pbFields');
  if (!fields) return;
  const samples = matrix.length;
  fields.innerHTML = `
    <div class="text-sm text-gray-300 border border-gray-800 bg-gray-900 rounded p-3">
      Using <strong>${samples}</strong> sample${samples === 1 ? '' : 's'} × <strong>${featureCount}</strong> feature${featureCount === 1 ? '' : 's'} from your current Mapping.
      <div class="text-xs text-gray-400 mt-1">Write the prompt with numeric placeholders like <code>{{0}}</code>, <code>{{1}}</code>, … matching the feature indices.</div>
    </div>
  `;
}
function updatePreview() {
  const tplEl = $('pbTemplate');
  const tpl = (tplEl?.value?.trim()) || buildDefaultTemplate(featureCount);
  const used = extractIndices(tpl);
  const bad = used.filter(i => i < 0 || i >= featureCount);
  const hint = bad.length
    ? `⚠️ Placeholder index out of range: ${bad.join(', ')} (max is ${featureCount - 1})`
    : `Using indices: ${used.length ? used.join(', ') : '(none)'}`;
  const example = is2D(matrix) ? matrix[0] : [];
  const filled = formatWithIndexPlaceholders(tpl, example);
  const pre = $('pbPreview');
  if (pre) pre.textContent = `${filled}\n\n${hint}\nSamples: ${matrix.length}`;
}
function updateSendBtnState() {
  const btn = $('pbSendBtn'); if (!btn) return;
  const tplEl = $('pbTemplate');
  const tpl = (tplEl?.value?.trim()) || buildDefaultTemplate(featureCount);
  const used = extractIndices(tpl);
  const bad = used.filter(i => i < 0 || i >= featureCount);
  const ok = is2D(matrix) && matrix.length > 0 && featureCount > 0 && bad.length === 0;
  btn.disabled = !ok;
}
function refreshFromTraining() {
  matrix = getMatrixFromTraining();
  renderInfoLine();
  updatePreview();
  updateSendBtnState();
}

// ---------------- POST /encode ----------------
async function sendToEncoder() {
  const btn = $('pbSendBtn'); if (btn) btn.disabled = true;
  const tplEl = $('pbTemplate');
  const prompt = (tplEl?.value?.trim()) || buildDefaultTemplate(featureCount);
  const progress = createProgress(); progress.begin(15000);

  try {
    if (!is2D(matrix) || !matrix.length) throw new Error('No samples found. Load data → Explorer → Mapping → Send to Training, then return.');
    const used = extractIndices(prompt);
    const bad = used.filter(i => i < 0 || i >= featureCount);
    if (bad.length) throw new Error(`Template uses invalid index: ${bad.join(', ')}`);

    const clean = matrix.map(row => row.map(v => Number(v)));
    if (!clean.every(row => row.every(isNum))) throw new Error('Data matrix contains non-numeric values.');

    console.log('[promptflow] POSTing to', ENCODER_URL);
    const res = await fetch(ENCODER_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, data: clean })
    });

    if (!res.ok) throw new Error(`Encoder responded ${res.status}`);
    const payload = await res.json().catch(() => ({}));
    showEmbeddingSummary(payload); notifyResponse(payload);
    progress.done('Sent');
  } catch (err) {
    console.error('[promptflow] encode error:', err);
    const r = ensureResultsUI(); $('pbResultSummary').textContent = `❌ ${err.message}`; $('pbResultPreview').textContent = ''; show(r);
    progress.fail('Failed');
  } finally { if (btn) btn.disabled = false; }
}

// ---------------- Init ----------------
async function init() {
  const card = $('promptBuilderCard'); if (!card) return;

  // We WANT the template + preview visible; hide dataset selector only
  const ds = $('pbDataset')?.closest('div'); if (ds) ds.style.display = 'none';

  try {
    const mappingData = await dataStore.getFeatureMapping();
    mapping = normalizeMapping(mappingData);
    if (!mapping || !Array.isArray(mapping.inputFeatures) || mapping.inputFeatures.length === 0) {
      $('pbFields').innerHTML = `<div class="text-sm text-red-400">
        No feature mapping found. Go to <em>Explorer</em> → <em>Mapping</em>, define features, then return here.
      </div>`;
      $('pbSendBtn').disabled = true; return;
    }
    featureCount = mapping.inputFeatures.length;

    // Pull whatever is already available
    matrix = getMatrixFromTraining();

    if (!is2D(matrix) || matrix.length === 0) {
      // Show a waiting note instead of an error
      $('pbFields').innerHTML = `
        <div class="text-sm text-yellow-300 border border-yellow-700 bg-yellow-900/30 rounded p-3">
          Waiting for preprocessed data… If you haven’t yet: Explorer → select rows → Mapping → <strong>Send to Training</strong>.
        </div>
      `;
      $('pbSendBtn').disabled = true;

      // Listen for the training module to announce readiness
      document.addEventListener('exolix:preprocessed-ready', () => {
        refreshFromTraining();
      }, { once: true });
    } else {
      renderInfoLine();
      updatePreview();
      updateSendBtnState();
    }

    $('pbTemplate')?.addEventListener('input', () => { updatePreview(); updateSendBtnState(); });
    $('pbSendBtn')?.addEventListener('click', sendToEncoder);
  } catch (e) {
    console.error('[promptflow] init error:', e);
    $('pbFields').innerHTML = `<div class="text-sm text-red-400">Error loading mapping.</div>`;
    $('pbSendBtn').disabled = true;
  }
}

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
