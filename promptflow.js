// promptflow.js — v16: template-only input; data matrix auto; waits for preprocessed-ready
'use strict';
import dataStore from './dataStore.js';

const ENCODER_URL = 'https://api.exolix.club/encode';
// Expected maximum encode time (approx 5 minutes)
const ENCODER_EXPECTED_MS = 5 * 60 * 1000; // 300000 ms
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
    setEditorText(buildDefaultTemplateWithNames());
    updatePreview();
    updateSendBtnState();
  }
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
  function begin(ms = 14000, msg = 'Processing…') {
    show(wrap);
    start = performance.now();
    duration = Math.max(1200, ms);
    const tick = () => {
      const t = performance.now() - start;
      const p = Math.min(100, (t / duration) * 100);
      set(p, msg, Math.max(0, (duration - t) / 1000));
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
let matrixStats = null; // { raw, kept, skippedInvalid, skippedUnmapped }

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
async function sendToEncoder() {
  const btn = $('pbGenerateEmbedding'); if (btn) btn.disabled = true;
  const prompt = getEditorText().trim() || buildDefaultTemplate(featureCount);
  const progress = createProgress();
  // Start a long (5 min) progress bar; will complete early if response returns sooner.
  progress.begin(ENCODER_EXPECTED_MS, 'Embedding (up to ~5 min)…');

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
    // Forward embedding to training pipeline
    if (typeof window.__setLLMEmbedding === 'function') {
      window.__setLLMEmbedding(payload);
    }
    // Show small preview subset
    const prevWrap = $('pbEmbeddingPreview');
    const prevBlock = $('pbEmbedPreviewBlock');
    if (prevWrap && prevBlock && payload && payload.embedding) {
      prevWrap.classList.remove('hidden');
      const emb = payload.embedding;
      const first = emb.slice(0, 3).map(row => row.slice(0, Math.min(8, row.length)));
      prevBlock.textContent = `Rows: ${emb.length}, Dims: ${emb[0].length}\nPreview (first 3 rows × first up to 8 dims):\n` + first.map(r => r.map(v => (typeof v === 'number'? v.toFixed(4): v)).join(', ')).join('\n');
    }
    progress.done('Sent');
  } catch (err) {
    console.error('[promptflow] encode error:', err);
    const r = ensureResultsUI(); $('pbResultSummary').textContent = `❌ ${err.message}`; $('pbResultPreview').textContent = ''; show(r);
    progress.fail('Failed');
  } finally { if (btn) btn.disabled = false; }
}

// Show embedding summary
function showEmbeddingSummary(payload) {
  const r = ensureResultsUI();
  const sum = $('pbResultSummary');
  const pre = $('pbResultPreview');
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
  sum.textContent = summary; pre.textContent = preview; show(r);
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
      editor.addEventListener('input', () => { updatePreview(); updateSendBtnState(); });
      editor.addEventListener('blur', () => highlightEditorPlaceholders(true));
    }
    $('pbGenerateEmbedding')?.addEventListener('click', sendToEncoder);
    $('pbClearEmbedding')?.addEventListener('click', () => {
      setEditorText(buildDefaultTemplateWithNames());
      embeddingMatrix = null;
      updatePreview(); updateSendBtnState();
      highlightEditorPlaceholders(true);
      const ed = $('pbTemplateEditor'); if (ed) { ed.focus(); selectAllEditor(); }
      const prevWrap = $('pbEmbeddingPreview'); if (prevWrap) prevWrap.classList.add('hidden');
      const summary = $('llmEmbeddingSummary'); if (summary) { summary.classList.add('hidden'); summary.textContent=''; }
      if (typeof window.__clearLLMEmbedding === 'function') { try { window.__clearLLMEmbedding(); } catch {} }
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
  ed.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    setEditorText(getEditorText() + ` {{${idx}}}`);
    updatePreview();
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
