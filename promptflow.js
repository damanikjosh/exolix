// promptflow.js — v16: template-only input; data matrix auto; waits for preprocessed-ready
'use strict';
import dataStore from './dataStore.js';

const ENCODER_URL = 'https://api.exolix.club/encode';
// Expected maximum encode time (approx 5 minutes)
const ENCODER_EXPECTED_MS = 5 * 60 * 1000; // 300000 ms legacy single-shot expectation
// Polling configuration for new async job API
const ENCODER_POLL_INTERVAL_MS = 1000;         // 1s between polls
const ENCODER_MAX_WAIT_MS = 10 * 60 * 1000;    // 10 minutes hard timeout
// Disable the legacy results box per user request (only progress bar + embedding preview remain)
const ENABLE_RESULTS_BOX = false;
const PROMPT_STORAGE_KEY = 'exolix.prompt.template.v1';
const TRAIN_MODE_KEY = 'exolix.train.mode.v1'; // stores '0' or '1'
console.log('[promptflow] v16 USING', ENCODER_URL, 'from', import.meta.url);

function savePromptTemplate() {
  try {
    const raw = getEditorText().trim();
    if (raw) localStorage.setItem(PROMPT_STORAGE_KEY, raw);
    else localStorage.removeItem(PROMPT_STORAGE_KEY);
  } catch (e) { console.warn('[promptflow] Failed to save prompt template', e); }
}
function loadSavedPromptTemplate() {
  try { return localStorage.getItem(PROMPT_STORAGE_KEY) || ''; } catch { return ''; }
}
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
  return `I have this exoplanet data with ${parts.join(', ')}. Summarize the information to create a meaningful embedding.`;
}

function buildDefaultTemplateWithNames() {
  if (!mapping || !Array.isArray(mapping.inputFeatures) || mapping.inputFeatures.length === 0) {
    return buildDefaultTemplate(featureCount);
  }
  const lines = mapping.inputFeatures.map((f, i) => {
    const name = f.featureName || f.name || `feature_${i}`;
    return `- ${name}: {{${i}}}`;
  });
  return (
    `You are an astrophysics assistant. Each row describes an exoplanet candidate observation.\n\n` +
    `Features:\n${lines.join('\n')}\n\nSummarize the information to create a meaningful embedding.`
  );
}

function ensureDefaultPromptInEditor() {
  const ed = $('pbTemplateEditor');
  if (!ed) return;
  const current = (ed.innerText || ed.textContent || '').trim();
  if (!current) {
    const saved = loadSavedPromptTemplate();
    if (saved) setEditorText(saved); else setEditorText(buildDefaultTemplateWithNames());
    updatePreview();
    updateSendBtnState();
    savePromptTemplate();
  }
}

// ---------------- Results UI (disabled) ----------------
function ensureResultsUI() {
  if (!ENABLE_RESULTS_BOX) return null;
  let r = $('pbResults');
  if (r) return r;
  const card = $('promptBuilderCard');
  if (!card) return null;
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
function setResult(summary, preview) {
  if (!ENABLE_RESULTS_BOX) {
    // Provide console feedback only
    if (summary) console.log('[promptflow][result]', summary);
    if (preview) console.debug('[promptflow][detail]', preview);
    return;
  }
  const r = ensureResultsUI();
  if (!r) return;
  const sum = $('pbResultSummary');
  const pre = $('pbResultPreview');
  if (sum) sum.textContent = summary || '';
  if (pre) pre.textContent = preview || '';
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
  let start = 0, duration = 14000, rafId = null, manualMode = false, currentPhase = 'normal';
  function formatEta(sec) {
    if (sec == null || !isFinite(sec)) return '';
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return m > 0 ? `${m}:${String(rem).padStart(2,'0')}` : `${rem}s`;
  }
  function set(p, txt, etaSec) {
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, p))}%`;
    if (txt && label) label.textContent = txt;
    if (etaEl) etaEl.textContent = etaSec != null ? formatEta(etaSec) : '';
  }
  function applyPhase(phase) {
    if (!fill) return;
    if (phase === currentPhase) return;
    fill.classList.remove('bg-blue-500','bg-amber-500','bg-red-500','bg-green-500');
    switch (phase) {
      case 'finalizing': fill.classList.add('bg-amber-500'); break;
      case 'failed': fill.classList.add('bg-red-500'); break;
      case 'done': fill.classList.add('bg-green-500'); break;
      default: fill.classList.add('bg-blue-500');
    }
    currentPhase = phase;
  }
  function begin(ms = 14000, msg = 'Processing…') {
    manualMode = false;
    show(wrap);
    start = performance.now();
    duration = Math.max(1200, ms);
    applyPhase('normal');
    const tick = () => {
      if (manualMode) return; // stop animated progression when switched to manual updates
      const t = performance.now() - start;
      const p = Math.min(100, (t / duration) * 100);
      set(p, msg, Math.max(0, (duration - t) / 1000));
      if (p < 100) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  function manual(msg = 'Queued…') {
    if (rafId) cancelAnimationFrame(rafId);
    manualMode = true;
    show(wrap);
    start = performance.now();
    applyPhase('normal');
    set(0, msg, undefined);
  }
  function done(msg = 'Completed') {
    if (rafId) cancelAnimationFrame(rafId);
    set(100, msg, 0);
    applyPhase('done');
    setTimeout(() => hide(wrap), 800);
  }
  function fail(msg = 'Failed') {
    if (rafId) cancelAnimationFrame(rafId);
    if (label) label.textContent = msg;
    if (fill) { fill.style.width = '100%'; }
    applyPhase('failed');
    if (etaEl) etaEl.textContent = '';
  }
  function update(progressPct, msg, etaSec, opts = {}) {
    manualMode = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    set(progressPct, msg, etaSec);
    if (opts.finalizing) applyPhase('finalizing');
    else if (currentPhase === 'finalizing' && !opts.finalizing) applyPhase('normal');
  }
  return { begin, manual, update, done, fail };
}

// ---------------- State ----------------
let mapping = null;
let featureCount = 0;
let matrix = []; // samples × features
let matrixStats = null; // { raw, kept, skippedInvalid, skippedUnmapped }
let embeddingMatrix = null; // stored embedding result
let embeddingMeta = null;  // { rows, dims, receivedAt }
let trainingInputMode = null; // 'raw' | 'llm-embedding'

// Public API for training/explorer integration
window.setTrainingInputMode = function(mode) {
  trainingInputMode = mode === 'llm-embedding' ? 'llm-embedding' : 'raw';
  try { localStorage.setItem(TRAIN_MODE_KEY, trainingInputMode === 'llm-embedding' ? '1' : '0'); } catch {}
  document.dispatchEvent(new CustomEvent('exolix:input-mode-changed', { detail: { mode: trainingInputMode } }));
};
window.getTrainingInputMode = function() {
  if (trainingInputMode) return trainingInputMode;
  try {
    const stored = localStorage.getItem(TRAIN_MODE_KEY);
    if (stored === '1') trainingInputMode = 'llm-embedding';
    else if (stored === '0') trainingInputMode = 'raw';
  } catch {}
  return trainingInputMode || 'raw';
};
window.getLLMEmbedding = function() { return embeddingMatrix; };
window.clearLLMEmbedding = function() {
  embeddingMatrix = null; embeddingMeta = null;
  document.dispatchEvent(new CustomEvent('exolix:embedding-cleared'));
};

function getMatrixFromTraining() {
  try { const m = window.getMappedFeatureMatrix?.(); return is2D(m) ? m : []; }
  catch { return []; }
}

// ---------------- UI helpers ----------------
function renderInfoLine() {
  const meta = $('pbFeatureMeta');
  if (!meta) return;
  const samples = matrix.length;
  let line = `Using <strong>${samples}</strong> row${samples===1?'':'s'} × <strong>${featureCount}</strong> features.`;
  if (matrixStats && matrixStats.raw && matrixStats.raw !== samples) {
    const skipped = matrixStats.skippedInvalid + matrixStats.skippedUnmapped;
    line += `<br><span class="text-xs text-amber-300">Filtered from ${matrixStats.raw} raw rows (skipped ${skipped}: ${matrixStats.skippedInvalid} invalid, ${matrixStats.skippedUnmapped} unmapped label).</span>`;
  }
  meta.innerHTML = line;
  // Render feature pills
  const pillWrap = $('pbFeaturePills');
  if (pillWrap && mapping && Array.isArray(mapping.inputFeatures)) {
    pillWrap.innerHTML = '';
    mapping.inputFeatures.forEach((f, idx) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'value-chip feature-pill';
      const name = f.featureName || f.name || `Feature ${idx}`;
      pill.textContent = name;
      pill.dataset.featureIndex = idx;
      // Prevent button from stealing focus so caret stays in editor if it was there
      pill.addEventListener('mousedown', (e) => { e.preventDefault(); });
      pill.addEventListener('click', () => insertPlaceholderAtCursor(idx));
      pillWrap.appendChild(pill);
    });
  }
}
function getEditorText() {
  const ed = $('pbTemplateEditor');
  if (!ed) return '';
  return ed.innerText || ed.textContent || '';
}
function setEditorText(txt) {
  const ed = $('pbTemplateEditor');
  if (ed) ed.textContent = txt;
}
// Auto-select helper for reset highlight
function selectAllEditor() {
  const ed = $('pbTemplateEditor');
  if (!ed) return;
  const range = document.createRange();
  range.selectNodeContents(ed);
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
}
// --- Caret utilities ---
function getCaretOffset(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  let caretOffset = 0;
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  while (treeWalker.nextNode()) {
    const node = treeWalker.currentNode;
    if (node === range.startContainer) {
      caretOffset += range.startOffset;
      break;
    } else {
      caretOffset += node.textContent.length;
    }
  }
  return caretOffset;
}
function setCaretOffset(root, offset) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remaining = offset;
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let found = false;
  while (treeWalker.nextNode()) {
    const node = treeWalker.currentNode;
    const len = node.textContent.length;
    if (remaining <= len) {
      range.setStart(node, Math.max(0, Math.min(remaining, len)));
      range.collapse(true);
      found = true;
      break;
    }
    remaining -= len;
  }
  if (!found) {
    // Place at end
    const last = root.lastChild;
    if (last) {
      if (last.nodeType === Node.TEXT_NODE) {
        range.setStart(last, last.textContent.length);
      } else {
        range.selectNodeContents(last);
        range.collapse(false);
      }
    } else {
      range.selectNodeContents(root);
      range.collapse(false);
    }
  }
  sel.removeAllRanges();
  sel.addRange(range);
}
function highlightEditorPlaceholders(force = false) {
  const ed = $('pbTemplateEditor');
  if (!ed) return;
  const raw = getEditorText();
  if (!force && ed.dataset.lastRaw === raw) return;
  const isFocused = (document.activeElement === ed);
  let caret = 0;
  if (isFocused) {
    caret = getCaretOffset(ed);
  }
  const safe = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const html = safe.replace(/\{\{\s*(\d+)\s*\}\}/g, '<span class="text-amber-300 font-semibold">{{$1}}</span>');
  ed.innerHTML = html;
  ed.dataset.lastRaw = raw;
  if (isFocused) {
    setCaretOffset(ed, caret);
  }
}
function updatePreview() {
  const tpl = getEditorText().trim() || buildDefaultTemplate(featureCount);
  const used = extractIndices(tpl);
  const bad = used.filter(i => i < 0 || i >= featureCount);
  const hint = bad.length
    ? `⚠️ Placeholder index out of range: ${bad.join(', ')} (max is ${featureCount - 1})`
    : `Using indices: ${used.length ? used.join(', ') : '(none)'}`;
  const example = is2D(matrix) ? matrix[0] : [];
  formatWithIndexPlaceholders(tpl, example); // filled example (not shown currently)
  const hintEl = $('pbPlaceholderHint');
  if (hintEl) hintEl.textContent = hint;
  const charCount = $('pbCharCount');
  if (charCount) charCount.textContent = `${tpl.length} chars`;
  highlightEditorPlaceholders();
}
function updateSendBtnState() {
  const btn = $('pbGenerateEmbedding'); if (!btn) return;
  const tpl = getEditorText().trim() || buildDefaultTemplate(featureCount);
  const used = extractIndices(tpl);
  const bad = used.filter(i => i < 0 || i >= featureCount);
  const ok = is2D(matrix) && matrix.length > 0 && featureCount > 0 && bad.length === 0;
  btn.disabled = !ok;
}
function refreshFromTraining() {
  matrix = getMatrixFromTraining();
  if (matrix && matrix.length) {
    featureCount = (matrix[0] || []).length;
    renderInfoLine();
    updatePreview();
    updateSendBtnState();
  }
}

// --------- Fallback: reconstruct matrix locally if training.js not loaded ---------
async function buildMatrixLocallyIfMissing() {
  if (matrix && matrix.length) return; // Already have something
  if (!featureCount || !mapping || !Array.isArray(mapping.inputFeatures)) return;
  try {
    console.log('[promptflow] Attempting local matrix reconstruction (training page not visited?)');
    const selection = await dataStore.getTrainingSelection();
    if (!selection || !Array.isArray(selection.tables) || selection.tables.length === 0) {
      console.warn('[promptflow] No training selection found in IndexedDB');
      return;
    }
    const sortedTables = [...selection.tables].sort((a,b) => a.tabOrder - b.tabOrder);
    const tableRecords = await Promise.all(sortedTables.map(async (t) => {
      try { return await dataStore.getRecordsByIds(t.selectedIds, t.datasetId); }
      catch (e) { console.error('[promptflow] Error loading records for', t.datasetId, e); return []; }
    }));
    // Build label encoder (subset) to skip unmapped labels like training.js
    let valueToIndex = null;
    if (mapping.labelMapping && Array.isArray(mapping.labelMapping.targetLabels)) {
      valueToIndex = new Map();
      mapping.labelMapping.targetLabels.forEach(lbl => {
        (lbl.mappedValues || []).forEach(v => valueToIndex.set(v, true));
      });
    }
    const built = [];
    let raw = 0, skippedInvalid = 0, skippedUnmapped = 0;
    tableRecords.forEach((records, tableIndex) => {
      records.forEach(rec => {
        raw++;
        const row = [];
        let invalid = false;
        mapping.inputFeatures.forEach(f => {
          const col = f.columns.find(c => c.tableIndex === tableIndex);
          if (col) {
            const v = rec[col.columnName];
            if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) invalid = true;
            row.push(v !== undefined && v !== null ? Number(v) : 0);
          } else {
            row.push(0);
          }
        });
        if (invalid) { skippedInvalid++; return; }
        // Output label check
        if (valueToIndex) {
          const outCol = mapping.outputFeature && mapping.outputFeature.columns && mapping.outputFeature.columns.find(c => c.tableIndex === tableIndex);
          let outVal = null;
            if (outCol) outVal = rec[outCol.columnName];
          if (outCol && (outVal === null || outVal === undefined || !valueToIndex.has(outVal))) {
            skippedUnmapped++; return;
          }
        }
        built.push(row);
      });
    });
    if (!built.length) { console.warn('[promptflow] Local reconstruction produced 0 usable rows.'); return; }
    matrix = built; featureCount = (matrix[0] || []).length;
    matrixStats = { raw, kept: built.length, skippedInvalid, skippedUnmapped };
    console.log(`[promptflow] ✅ Reconstructed matrix locally: kept ${built.length}/${raw} rows (skipped ${skippedInvalid} invalid, ${skippedUnmapped} unmapped) dims=${featureCount}`);
    renderInfoLine(); updatePreview(); updateSendBtnState();
  } catch (err) {
    console.error('[promptflow] Local matrix reconstruction failed:', err);
  }
}

// ---------------- POST /encode ----------------
let currentEncodeJob = null; // { jobId, timerId, aborted, lastProgress, finalizeWaits }

// Small helper: show/hide a finalizing transfer indicator (appears near progress bar)
function setTransferIndicator(on, text = 'Receiving large embedding…') {
  let el = $('pbTransferIndicator');
  const host = $('pbProgressWrap')?.parentElement || $('promptBuilderCard');
  if (!on) {
    if (el) el.remove();
    return;
  }
  if (!host) return;
  if (!el) {
    el = document.createElement('div');
    el.id = 'pbTransferIndicator';
    el.className = 'mt-2 text-xs text-blue-300 flex items-center gap-2 animate-pulse';
    el.innerHTML = `<span class="inline-block h-3 w-3 rounded-full bg-blue-400 animate-ping"></span><span class="indicator-text"></span>`;
    host.appendChild(el);
  }
  const txtNode = el.querySelector('.indicator-text');
  if (txtNode) txtNode.textContent = text;
}
async function sendToEncoder() {
  const btn = $('pbGenerateEmbedding'); if (btn) btn.disabled = true;
  const prompt = getEditorText().trim() || buildDefaultTemplate(featureCount);
  const progress = createProgress();
  const startTime = performance.now();

  // If there is a previous job polling, cancel it.
  if (currentEncodeJob && currentEncodeJob.intervalId) {
    currentEncodeJob.aborted = true;
    clearInterval(currentEncodeJob.intervalId);
  }

  try {
    if (!is2D(matrix) || !matrix.length) throw new Error('No samples found. Load data → Explorer → Mapping → Send to Training, then return.');
    const used = extractIndices(prompt);
    const bad = used.filter(i => i < 0 || i >= featureCount);
    if (bad.length) throw new Error(`Template uses invalid index: ${bad.join(', ')}`);

    const clean = matrix.map(row => row.map(v => Number(v)));
    if (!clean.every(row => row.every(isNum))) throw new Error('Data matrix contains non-numeric values.');

    console.log('[promptflow] (async) POSTing to', ENCODER_URL);
    progress.manual('Submitting…');
    const res = await fetch(ENCODER_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, data: clean })
    });
    if (!res.ok) throw new Error(`Encoder responded ${res.status}`);
    const initial = await res.json().catch(() => ({}));

    // Legacy fallback: embedding returned immediately
    if (initial && initial.embedding) {
      console.log('[promptflow] Received immediate embedding (legacy behaviour).');
      progress.update(80, 'Processing…');
      finalizeEmbedding(initial, progress);
      return;
    }

    const jobId = initial.job_id || initial.jobId;
    if (!jobId) throw new Error('No job_id returned by encoder API');
    console.log('[promptflow] Job submitted id=', jobId);
  setResult(`🕒 Job submitted: ${jobId}`, 'Polling for progress…');
    progress.update(0, 'Queued…');

    // Helper ETA computing
    function estimateEta(progressFraction) {
      if (progressFraction <= 0 || progressFraction >= 1) return undefined;
      const elapsed = (performance.now() - startTime) / 1000; // sec
      const total = elapsed / progressFraction;
      return Math.max(0, total - elapsed);
    }

  currentEncodeJob = { jobId, aborted: false, timerId: null, lastProgress: 0, finalizeWaits: 0 };
    const pollUrl = `${ENCODER_URL.replace(/\/$/, '')}/${jobId}`;

    let polling = false; // guard against overlap
    async function pollOnce() {
      if (!currentEncodeJob || currentEncodeJob.aborted || polling) return;
      polling = true;
      try {
        const pr = await fetch(pollUrl, { method: 'GET', mode: 'cors' });
        let info = null;
        // Try to parse body even on 404 (API may have deleted job right after delivering result)
        try { info = await pr.json(); } catch { info = {}; }
        if (pr.status === 404) {
          // If we already reached high progress and now 404, assume completion if embedding present
            if (info && Array.isArray(info.embedding)) {
              console.warn('[promptflow] 404 but embedding payload present – treating as complete');
              finalizeEmbedding(info, progress, jobId);
              currentEncodeJob = null;
              return;
            }
            if (currentEncodeJob.lastProgress >= 0.95) {
              console.warn('[promptflow] Job 404 after high progress; assuming completed but lost result.');
              throw new Error('Job finished but result not retrieved. Please retry.');
            }
            throw new Error('Job disappeared (404)');
        }
        if (!pr.ok) throw new Error(`Poll HTTP ${pr.status}`);
        const status = info.status || 'unknown';
        const prog = Number(info.progress || 0);
        currentEncodeJob.lastProgress = prog;
        // If embedding arrives early regardless of status value
        if (Array.isArray(info.embedding)) {
          setTransferIndicator(false);
          finalizeEmbedding(info, progress, jobId);
          currentEncodeJob = null;
          return;
        }
        if (status === 'error') throw new Error(info.error || 'Encoder job error');

        // Handle "done" status without immediate embedding: allow a few extra polling cycles (grace window)
        if (status === 'done' && !Array.isArray(info.embedding)) {
          currentEncodeJob.finalizeWaits = (currentEncodeJob.finalizeWaits || 0) + 1;
          if (currentEncodeJob.finalizeWaits > 8) { // ~8 seconds grace
            throw new Error('Embedding payload not delivered after completion. Please retry.');
          }
          // Show finalizing indicator and keep progress at 99.9%
          setTransferIndicator(true, 'Finalizing… receiving embedding payload');
          progress.update(99.9, 'Finalizing…', undefined, { finalizing: true });
          return; // schedule next poll
        }

        const pctRaw = Math.max(0, Math.min(100, prog * 100));
        let pct = pctRaw;
        // If progress reports 100% but embedding not yet attached, keep UI <100 to signal waiting
        if (pctRaw >= 100) {
          pct = 99.9;
          setTransferIndicator(true, 'Finalizing… receiving embedding payload');
        } else if (pctRaw >= 99) {
          setTransferIndicator(true, 'Almost done… preparing embedding');
        } else {
          setTransferIndicator(false);
        }
        const eta = estimateEta(prog);
        let labelTxt = 'Embedding…';
        if (status === 'queued' || status === 'pending') labelTxt = 'Queued…';
        else if (status === 'running' || status === 'processing') labelTxt = `Embedding ${pct.toFixed(1)}%`;
        setResult(`⏳ Job ${jobId} ${status}`, `Progress: ${pctRaw.toFixed(1)}%`);
  const finalizingPhase = (pct >= 99.9 && pct < 100) && status !== 'error';
  progress.update(pct, labelTxt, eta, { finalizing: finalizingPhase });
        if (performance.now() - startTime > ENCODER_MAX_WAIT_MS) {
          throw new Error('Encoding job timed out');
        }
      } catch (e) {
        if (currentEncodeJob) currentEncodeJob.aborted = true;
        handleEncodeError(e, progress);
        return; // stop further scheduling
      } finally {
        polling = false;
      }
      // schedule next only if still active
      if (currentEncodeJob && !currentEncodeJob.aborted) {
        currentEncodeJob.timerId = setTimeout(pollOnce, ENCODER_POLL_INTERVAL_MS);
      }
    }

    // Kick off polling (sequential)
    await pollOnce();
  } catch (err) {
    handleEncodeError(err, progress);
  }
}

function handleEncodeError(err, progress) {
  console.error('[promptflow] encode error:', err);
  setResult(`❌ ${err.message}`, '');
  progress.fail('Failed');
  const btn = $('pbGenerateEmbedding'); if (btn) btn.disabled = false;
}

function finalizeEmbedding(payload, progress, jobId) {
  try {
    setTransferIndicator(false);
    showEmbeddingSummary(payload);
    notifyResponse(payload);
    if (typeof window.__setLLMEmbedding === 'function') {
      window.__setLLMEmbedding(payload);
    }
    const prevWrap = $('pbEmbeddingPreview');
    const prevBlock = $('pbEmbedPreviewBlock');
    if (prevWrap && prevBlock && payload && payload.embedding) {
      prevWrap.classList.remove('hidden');
      const emb = payload.embedding;
      embeddingMatrix = emb;
      embeddingMeta = { rows: emb.length, dims: emb[0]?.length || 0, receivedAt: Date.now(), jobId };
      document.dispatchEvent(new CustomEvent('exolix:embedding-ready', { detail: embeddingMeta }));
      const first = emb.slice(0, 3).map(row => row.slice(0, Math.min(8, row.length)));
      prevBlock.textContent = `Rows: ${emb.length}, Dims: ${emb[0].length}\nPreview (first 3 rows × first up to 8 dims):\n` + first.map(r => r.map(v => (typeof v === 'number'? v.toFixed(4): v)).join(', ')).join('\n');
    }
    progress.done('Completed');
  } catch (e) {
    handleEncodeError(e, progress);
    return;
  }
  const btn = $('pbGenerateEmbedding'); if (btn) btn.disabled = false;
}

// Show embedding summary
function showEmbeddingSummary(payload) {
  let summary = 'ℹ️ Response received.';
  let preview = '';
  const emb = payload && payload.embedding;
  if (Array.isArray(emb) && Array.isArray(emb[0])) {
    const rows = emb.length; const cols = emb[0].length;
    summary = `✅ Received embedding: ${rows} × ${cols}`;
    const firstRow = emb[0].slice(0, Math.min(8, cols));
    preview = `First row (first ${firstRow.length} values):\n` + firstRow.map(v => (typeof v === 'number' ? v.toFixed(4) : String(v))).join(', ');
  } else if (payload && (payload.result || payload.label)) {
    summary = `✅ Result: ${payload.result || payload.label}`;
  } else {
    preview = JSON.stringify(payload, null, 2);
  }
  setResult(summary, preview);
}

// ---------------- Init ----------------
async function init() {
  const card = $('promptBuilderCard'); if (!card) return;
  const ds = $('pbDataset')?.closest('div'); if (ds) ds.style.display = 'none';
  try {
    const mappingData = await dataStore.getFeatureMapping();
    mapping = normalizeMapping(mappingData);
    if (!mapping || !Array.isArray(mapping.inputFeatures) || mapping.inputFeatures.length === 0) {
      $('pbFields').innerHTML = `<div class="text-sm text-red-400">No feature mapping found. Go to <em>Explorer</em> → <em>Mapping</em>, define features, then return here.</div>`;
      $('pbSendBtn').disabled = true; return;
    }
    featureCount = mapping.inputFeatures.length;
    matrix = getMatrixFromTraining();
    if (!is2D(matrix) || matrix.length === 0) {
      await buildMatrixLocallyIfMissing();
      if (!is2D(matrix) || matrix.length === 0) {
        $('pbFields').innerHTML = `
          <div class="text-sm text-yellow-300 border border-yellow-700 bg-yellow-900/30 rounded p-3 space-y-2">
            <div>Waiting for preprocessed data…</div>
            <div class="text-xs text-yellow-200">Either open the Training page once or let this page reconstruct automatically (it will retry when selection changes).</div>
          </div>`;
        $('pbSendBtn').disabled = true;
        document.addEventListener('exolix:preprocessed-ready', () => { refreshFromTraining(); if (!matrix.length) buildMatrixLocallyIfMissing(); }, { once: true });
        // After training preprocessed data arrives, overwrite any larger locally-built matrix for consistency
        document.addEventListener('exolix:preprocessed-ready', () => {
          const trainingMatrix = getMatrixFromTraining();
          if (is2D(trainingMatrix) && trainingMatrix.length && trainingMatrix.length !== matrix.length) {
            console.log('[promptflow] 🔄 Syncing matrix to training preprocessed size', trainingMatrix.length, 'prev', matrix.length);
            matrix = trainingMatrix; matrixStats = null; renderInfoLine(); updatePreview(); updateSendBtnState();
          }
        }, { once: true });
        setTimeout(() => { if (!matrix.length) buildMatrixLocallyIfMissing(); }, 2000);
      }
    }
    if (is2D(matrix) && matrix.length) { renderInfoLine(); updatePreview(); updateSendBtnState(); }
    ensureDefaultPromptInEditor();
    const editor = $('pbTemplateEditor');
    if (editor) {
      editor.addEventListener('input', () => { updatePreview(); updateSendBtnState(); savePromptTemplate(); });
      editor.addEventListener('blur', () => highlightEditorPlaceholders(true));
    }
    $('pbGenerateEmbedding')?.addEventListener('click', sendToEncoder);
    $('pbClearEmbedding')?.addEventListener('click', () => {
      setEditorText(buildDefaultTemplateWithNames());
  embeddingMatrix = null;
  embeddingMeta = null;
  document.dispatchEvent(new CustomEvent('exolix:embedding-cleared'));
      updatePreview(); updateSendBtnState();
      highlightEditorPlaceholders(true);
      const ed = $('pbTemplateEditor'); if (ed) { ed.focus(); selectAllEditor(); }
      const prevWrap = $('pbEmbeddingPreview'); if (prevWrap) prevWrap.classList.add('hidden');
      const summary = $('llmEmbeddingSummary'); if (summary) { summary.classList.add('hidden'); summary.textContent=''; }
      if (typeof window.__clearLLMEmbedding === 'function') { try { window.__clearLLMEmbedding(); } catch {} }
      savePromptTemplate();
    });

  } catch (e) {
    console.error('[promptflow] init error:', e);
    $('pbFields').innerHTML = `<div class="text-sm text-red-400">Error loading mapping.</div>`;
    $('pbSendBtn').disabled = true;
  }
}

// Re-add missed init invocation and helper that were removed during refactor
function insertPlaceholderAtCursor(idx) {
  const ed = $('pbTemplateEditor');
  if (!ed) return;
  const wasFocused = document.activeElement === ed;
  if (!wasFocused) {
    // Append at end if editor not focused (requested behavior)
    setEditorText(getEditorText() + ` {{${idx}}}`);
    updatePreview();
    savePromptTemplate?.();
    return;
  }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    setEditorText(getEditorText() + ` {{${idx}}}`);
    updatePreview();
    savePromptTemplate?.();
    return;
  }
  const range = sel.getRangeAt(0);
  const textNode = document.createTextNode(` {{${idx}}}`);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  updatePreview();
  savePromptTemplate?.();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
