import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { createGrid } from 'ag-grid-community';
import dataStore from './dataStore.js';
import datasetManager from './datasetManager.js';

ModuleRegistry.registerModules([AllCommunityModule]);

// State management
const state = {
  tables: [], // Array of {id, name, datasetId, gridApi, data, columns, selectedRows}
  activeTableId: null,
  tableCounter: 0,
  featureMapping: null, // Will be loaded from dataStore
  model: null, // Cached loaded TFJS model
  modelAvailable: false, // Whether saved model exists
  modelStorageUrl: null, // Chosen storage URL for loaded model (indexeddb preferred)
  labelNames: [], // Ordered label names from mapping
  predictionInProgress: false // Prevent concurrent prediction requests
};

// Persistence / integration keys (mirrors promptflow & training)
const TRAIN_MODE_KEY = 'exolix.train.mode.v1'; // '0' raw, '1' llm embedding
const PROMPT_STORAGE_KEY = 'exolix.prompt.template.v1';
const ENCODER_URL = 'https://api.exolix.club/encode';
let embeddingStatusEl = null; // ephemeral UI element for embedding prediction status
// Async embedding job polling configuration
const ENCODER_POLL_INTERVAL_MS = 1000; // 1s
const ENCODER_MAX_WAIT_MS = 10 * 60 * 1000; // 10 min hard timeout
let currentEmbeddingJob = null; // { jobId, aborted, timerId, lastProgress, finalizeWaits }

// ---------------- Embedding Progress UI ----------------
function ensureEmbeddingPanel() {
  let panel = document.getElementById('embeddingJobPanel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'embeddingJobPanel';
  panel.className = 'fixed bottom-4 right-4 w-80 max-w-[90vw] p-4 rounded-lg bg-gray-900/95 border border-gray-700 shadow-xl text-xs font-medium text-gray-200 space-y-2 backdrop-blur-sm z-50';
  panel.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <span id="embedJobStatus" class="text-indigo-200 truncate">Preparing…</span>
      <button id="embedJobCancel" type="button" class="text-red-300 hover:text-red-400 text-[10px] uppercase tracking-wide">Cancel</button>
    </div>
    <div class="h-2 w-full bg-gray-700/60 rounded overflow-hidden">
      <div id="embedJobFill" class="h-full bg-indigo-500 transition-all duration-300 ease-out" style="width:0%"></div>
    </div>
    <div id="embedJobDetail" class="text-[11px] text-gray-400 leading-snug min-h-[1.25rem]"></div>
  `;
  document.body.appendChild(panel);
  // Wire cancel
  panel.querySelector('#embedJobCancel').addEventListener('click', () => {
    if (currentEmbeddingJob) {
      currentEmbeddingJob.aborted = true;
      if (currentEmbeddingJob.timerId) clearTimeout(currentEmbeddingJob.timerId);
      updateEmbeddingPanel(null, 'Cancelled', 'Job aborted by user');
      setTimeout(hideEmbeddingPanel, 1500);
      // Resolve promise so outer await can proceed (treated as graceful cancellation)
      if (currentEmbeddingJob._resolve) currentEmbeddingJob._resolve({ cancelled: true });
      currentEmbeddingJob = null;
    }
  });
  return panel;
}
function hideEmbeddingPanel() {
  const panel = document.getElementById('embeddingJobPanel');
  if (panel) panel.remove();
}
function updateEmbeddingPanel(pct, status, detail, options = {}) {
  const panel = ensureEmbeddingPanel();
  const statusEl = panel.querySelector('#embedJobStatus');
  const fillEl = panel.querySelector('#embedJobFill');
  const detailEl = panel.querySelector('#embedJobDetail');
  if (statusEl && status) statusEl.textContent = status;
  if (detailEl && detail !== undefined) detailEl.textContent = detail;
  if (fillEl && pct != null) {
    const width = Math.max(0, Math.min(100, pct));
    fillEl.style.width = width + '%';
    if (options.finalizing) {
      fillEl.classList.remove('bg-indigo-500');
      fillEl.classList.add('bg-amber-500');
    } else if (options.error) {
      fillEl.classList.remove('bg-indigo-500');
      fillEl.classList.add('bg-red-500');
    }
  }
}

// Helpers for mode & prompt
function getTrainingMode() {
  try { return localStorage.getItem(TRAIN_MODE_KEY) || '0'; } catch { return '0'; }
}
function getSavedPromptTemplate() {
  try { return localStorage.getItem(PROMPT_STORAGE_KEY) || ''; } catch { return ''; }
}
function buildDefaultTemplate(featureCount) {
  if (!featureCount) return 'Row with feature {{0}}.';
  const parts = Array.from({ length: featureCount }, (_, i) => `f${i}={{${i}}}`);
  return `Generate an embedding for exoplanet observation with ${parts.join(', ')}.`;
}

// Load feature mapping from database
async function loadFeatureMapping() {
  try {
    const mappingData = await dataStore.getFeatureMapping();
    if (mappingData && mappingData.mapping) {
      state.featureMapping = mappingData.mapping;
      // Build ordered label names if present
      if (state.featureMapping.labelMapping && Array.isArray(state.featureMapping.labelMapping.targetLabels)) {
        // Sort by id (index) to ensure consistent order with training one-hot encoding
        state.labelNames = [...state.featureMapping.labelMapping.targetLabels]
          .sort((a, b) => a.id - b.id)
          .map(l => l.name);
      }
      return true;
    }
  } catch (error) {
    console.log('No feature mapping found (this is okay)');
  }
  return false;
}

// Get feature name for a column
function getFeatureForColumn(tableName, columnName) {
  if (!state.featureMapping) return null;
  
  // Check input features
  for (let i = 0; i < state.featureMapping.inputFeatures.length; i++) {
    const feature = state.featureMapping.inputFeatures[i];
    const col = feature.columns.find(c => 
      c.tableName === tableName && c.columnName === columnName
    );
    if (col) return `Input ${i + 1}`;
  }
  
  // Check output feature
  if (state.featureMapping.outputFeature) {
    const col = state.featureMapping.outputFeature.columns.find(c => 
      c.tableName === tableName && c.columnName === columnName
    );
    if (col) return 'Output';
  }
  
  return null;
}

// Helper to get base URL for assets (handles GitHub Pages subdirectory)
function getAssetUrl(path) {
  // Get the base path from the current location
  const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
  return `${window.location.origin}${basePath}/${path}`;
}

// Presets for common datasets
const PRESETS = {
  kepler: {
    name: 'Kepler Object of Interest 2025',
    get url() { return getAssetUrl('data/cumulative_2025.09.29_21.37.15.csv'); },
    datasetId: 'koi_2025',
    // Auto-setup configuration for Kepler preset
    autoSetup: {
      featureColumns: [
        'koi_period',
        'koi_impact',
        'koi_duration',
        'koi_depth',
        'koi_prad',
        'koi_teq',
        'koi_insol',
        'koi_steff',
        'koi_slogg',
        'koi_srad',
        'ra',
        'dec',
        'koi_kepmag'
      ],
      labelColumn: 'koi_disposition',
      // First step refactor: move label grouping definition into preset config
      // (semantic equivalent to previous inline candidate/false positive grouping)
      labelGroups: [
        { name: 'CANDIDATE', values: ['CONFIRMED'] },
        { name: 'FALSE POSITIVE', values: ['FALSE POSITIVE'] }
      ]
    }
  },
  tess: {
    name: 'TESS Object of Interest 2025',
    get url() { return getAssetUrl('data/TOI_2025.10.01_18.37.10.csv'); },
    datasetId: 'toi_2025'
  }
};

// Create column definitions from data with feature mapping
function createColumnDefs(data, tableName) {
  if (!data || data.length === 0) return [];
  
  const firstRow = data[0];
  const columns = Object.keys(firstRow);
  
  const columnDefs = [
    { 
      field: 'select', 
      headerName: '', 
      checkboxSelection: true, 
      headerCheckboxSelection: true,
      width: 50,
      pinned: 'left',
      sortable: false,
      filter: false,
      resizable: false
    }
  ];
  
  columns.forEach(col => {
    const featureName = getFeatureForColumn(tableName, col);
    let headerName = col;
    
    // Append feature name in brackets if mapped
    if (featureName) {
      headerName = `${col} (${featureName})`;
    }
    
    const colDef = {
      field: col,
      headerName: headerName,
      width: 150,
      sortable: true,
      filter: true,
      resizable: true,
      headerClass: featureName ? 'highlight-header' : '',
      cellClass: featureName ? 'highlight-cell' : ''
    };
    
    columnDefs.push(colDef);
  });
  
  return columnDefs;
}

// Ensure prediction column exists (pinned right) for a grid
function ensurePredictionColumn(table) {
  if (!table || !table.gridApi) return;
  // Access current column definitions from the grid options
  const currentDefs = table.gridApi.getColumnDefs ? table.gridApi.getColumnDefs() : null;
  if (!currentDefs) return;
  if (currentDefs.some(def => def.field === '__prediction')) return; // already present
  const newCol = {
    headerName: 'Prediction',
    field: '__prediction',
    pinned: 'right',
    sortable: true,
    filter: true,
    width: 160,
    cellClass: params => params.value ? 'prediction-cell font-semibold text-green-300 bg-green-900/30' : 'text-gray-600',
    valueGetter: params => params.data.__prediction || ''
  };
  const updated = [...currentDefs, newCol];
  table.gridApi.setGridOption('columnDefs', updated);
  // Force refresh to render new pinned column
  if (table.gridApi.refreshHeader) {
    table.gridApi.refreshHeader();
  }
}

// Detect if saved model exists (prefer IndexedDB, fallback localStorage)
async function detectModel() {
  try {
    const tf = await import('@tensorflow/tfjs');
    await tf.ready();
    const models = await tf.io.listModels();
    // Preferred new storage
    if (models['indexeddb://exolix-model']) {
      state.modelAvailable = true;
      state.modelStorageUrl = 'indexeddb://exolix-model';
    } else if (models['localstorage://exolix-model']) { // Legacy fallback
      state.modelAvailable = true;
      state.modelStorageUrl = 'localstorage://exolix-model';
    } else {
      state.modelAvailable = false; state.modelStorageUrl = null;
    }
    const btn = document.getElementById('predictWithModel');
    if (btn) btn.disabled = !state.modelAvailable;
    if (state.modelAvailable) {
      console.log(`[explorer] ✅ Found trained model at ${state.modelStorageUrl}`);
    } else {
      console.log('[explorer] ℹ️ No trained model found yet');
    }
  } catch (e) {
    console.warn('Model detection failed:', e);
  }
}

// Load model (cached)
async function loadModelIfNeeded() {
  if (state.model) return state.model;
  if (!state.modelAvailable || !state.modelStorageUrl) return null;
  const tf = await import('@tensorflow/tfjs');
  await tf.ready();
  console.log('[explorer] Loading model from', state.modelStorageUrl);
  state.model = await tf.loadLayersModel(state.modelStorageUrl);
  return state.model;
}

// Build feature vector for a row based on current mapping and table order
function buildFeatureVectorForRow(row, tableName) {
  if (!state.featureMapping || !Array.isArray(state.featureMapping.inputFeatures)) return null;
  const values = [];
  // For each input feature in order
  state.featureMapping.inputFeatures.forEach(feature => {
    // Find mapping entry for this table
    const col = feature.columns.find(c => c.tableName === tableName);
    if (!col) {
      values.push(0); // Missing for this table
    } else {
      const v = row[col.columnName];
      const num = typeof v === 'number' ? v : parseFloat(v);
      values.push(isFinite(num) ? num : 0);
    }
  });
  return values;
}

// RAW vector prediction path (mode 0)
async function runPredictionsRaw(table, selectedRows) {
  const model = await loadModelIfNeeded();
  if (!model) { throw new Error('Failed to load model'); }
  const tf = await import('@tensorflow/tfjs'); await tf.ready();
  const featureCount = state.featureMapping.inputFeatures.length;
  const batchSize = 512;
  for (let i = 0; i < selectedRows.length; i += batchSize) {
    const batchRows = selectedRows.slice(i, i + batchSize);
    const matrix = batchRows.map(r => buildFeatureVectorForRow(r, table.name));
    const tensor = tf.tensor2d(matrix, [matrix.length, featureCount]);
    const preds = model.predict(tensor);
    const predIndices = preds.argMax(-1).dataSync();
    batchRows.forEach((r, idx) => {
      const labelIndex = predIndices[idx];
      r.__prediction = (state.labelNames && state.labelNames[labelIndex] !== undefined)
        ? state.labelNames[labelIndex]
        : `Class ${labelIndex}`;
    });
    tf.dispose([tensor, preds]);
  }
}

// EMBEDDING path (mode 1): generate on-the-fly embedding via /encode then predict
async function runPredictionsEmbedding(table, selectedRows) {
  const featureCount = state.featureMapping.inputFeatures.length;
  // Build raw numeric matrix
  const rawMatrix = selectedRows.map(r => buildFeatureVectorForRow(r, table.name));
  // Validate numeric
  if (!rawMatrix.every(row => Array.isArray(row) && row.length === featureCount)) {
    throw new Error('Invalid feature vectors for embedding');
  }
  // Prompt
  let prompt = getSavedPromptTemplate().trim();
  if (!prompt) prompt = buildDefaultTemplate(featureCount);
  // If a previous job running, abort it
  if (currentEmbeddingJob && currentEmbeddingJob.timerId) {
    currentEmbeddingJob.aborted = true;
    clearTimeout(currentEmbeddingJob.timerId);
  }
  currentEmbeddingJob = null;
  const startTime = performance.now();
  updateEmbeddingPanel(0, 'Submitting…', `Rows: ${rawMatrix.length}  Dims(raw): ${featureCount}`);

  // Submit job (or legacy immediate response)
  let initial;
  try {
    const res = await fetch(ENCODER_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, data: rawMatrix })
    });
    if (!res.ok) throw new Error('Encoder HTTP ' + res.status);
    initial = await res.json().catch(() => ({}));
  } catch (e) {
    updateEmbeddingPanel(0, 'Error', e.message, { error: true });
    throw e;
  }

  // Legacy immediate embedding
  if (initial && Array.isArray(initial.embedding)) {
    // Wrap in a resolved promise interface for consistent caller handling
    await finalizeEmbeddingPrediction(initial.embedding, selectedRows, table);
    updateEmbeddingPanel(100, 'Done', 'Predictions complete ✓');
    setTimeout(hideEmbeddingPanel, 2500);
    return { success: true, immediate: true };
  }

  const jobId = initial.job_id || initial.jobId;
  if (!jobId) {
    updateEmbeddingPanel(0, 'Error', 'No job_id in response', { error: true });
    throw new Error('No job_id from encoder');
  }
  console.log('[explorer] (EMBED) Job ID', jobId);
  updateEmbeddingPanel(0, 'Queued…', `Job ${jobId.substring(0,8)}…`);

  // Promise that resolves/rejects when embedding + predictions finish
  let lifecycleResolve, lifecycleReject;
  const lifecyclePromise = new Promise((res, rej) => { lifecycleResolve = res; lifecycleReject = rej; });

  currentEmbeddingJob = { jobId, aborted: false, timerId: null, lastProgress: 0, finalizeWaits: 0, _resolve: lifecycleResolve, _reject: lifecycleReject };
  const pollUrl = `${ENCODER_URL.replace(/\/$/, '')}/${jobId}`;

  function eta(progressFraction) {
    if (!progressFraction || progressFraction <= 0 || progressFraction >= 1) return undefined;
    const elapsed = (performance.now() - startTime)/1000;
    return Math.max(0, (elapsed / progressFraction) - elapsed);
  }

  let polling = false;
  const pollOnce = async () => {
    if (!currentEmbeddingJob || currentEmbeddingJob.aborted || polling) return;
    polling = true;
    try {
      const pr = await fetch(pollUrl, { method: 'GET', mode: 'cors' });
      let info = {};
      try { info = await pr.json(); } catch { info = {}; }
      if (pr.status === 404) {
        if (info && Array.isArray(info.embedding)) {
          console.warn('[explorer] 404 but embedding present (treat complete)');
          await finalizeEmbeddingPrediction(info.embedding, selectedRows, table);
          updateEmbeddingPanel(100, 'Done', 'Predictions complete ✓');
          if (currentEmbeddingJob && currentEmbeddingJob._resolve) currentEmbeddingJob._resolve({ success: true });
          currentEmbeddingJob = null;
          setTimeout(hideEmbeddingPanel, 2500);
          return;
        }
        if (currentEmbeddingJob.lastProgress >= 0.95) {
          throw new Error('Job finished but embedding lost');
        }
        throw new Error('Job disappeared (404)');
      }
      if (!pr.ok) throw new Error('Poll HTTP ' + pr.status);
      const status = info.status || 'unknown';
      const prog = Number(info.progress || 0);
      currentEmbeddingJob.lastProgress = prog;
      if (Array.isArray(info.embedding)) {
        await finalizeEmbeddingPrediction(info.embedding, selectedRows, table);
        updateEmbeddingPanel(100, 'Done', 'Predictions complete ✓');
        if (currentEmbeddingJob && currentEmbeddingJob._resolve) currentEmbeddingJob._resolve({ success: true });
        currentEmbeddingJob = null;
        setTimeout(hideEmbeddingPanel, 2500);
        return;
      }
      if (status === 'error') throw new Error(info.error || 'Encoder job error');
      if (status === 'done') {
        currentEmbeddingJob.finalizeWaits++;
        if (currentEmbeddingJob.finalizeWaits > 8) throw new Error('Embedding not delivered after completion');
        updateEmbeddingPanel(99.9, 'Finalizing…', 'Receiving embedding…', { finalizing: true });
      } else {
        let pctRaw = Math.max(0, Math.min(100, prog * 100));
        let pct = pctRaw;
        if (pctRaw >= 100) { pct = 99.9; updateEmbeddingPanel(pct, 'Finalizing…', 'Receiving embedding…', { finalizing: true }); }
        else if (pctRaw >= 99) updateEmbeddingPanel(pct, 'Almost done…', `Progress ${pctRaw.toFixed(1)}%`);
        else updateEmbeddingPanel(pct, status === 'queued' || status === 'pending' ? 'Queued…' : `Embedding ${pct.toFixed(1)}%`, `Progress ${pctRaw.toFixed(1)}%  ETA: ${eta(prog) ? eta(prog).toFixed(1)+'s' : '—'}`);
      }
      if (performance.now() - startTime > ENCODER_MAX_WAIT_MS) throw new Error('Embedding job timed out');
    } catch (e) {
      if (currentEmbeddingJob) currentEmbeddingJob.aborted = true;
      updateEmbeddingPanel(currentEmbeddingJob?.lastProgress ? currentEmbeddingJob.lastProgress*100 : 0, 'Error', e.message, { error: true });
      if (currentEmbeddingJob && currentEmbeddingJob._reject) currentEmbeddingJob._reject(e);
      throw e;
    } finally {
      polling = false;
    }
    if (currentEmbeddingJob && !currentEmbeddingJob.aborted) {
      currentEmbeddingJob.timerId = setTimeout(pollOnce, ENCODER_POLL_INTERVAL_MS);
    }
  };
  await pollOnce();
  return lifecyclePromise;
}

// Finalize: predict with received embedding matrix
async function finalizeEmbeddingPrediction(embeddingMatrix, selectedRows, table) {
  if (!Array.isArray(embeddingMatrix) || !embeddingMatrix.length || !Array.isArray(embeddingMatrix[0])) {
    throw new Error('Bad embedding payload');
  }
  if (embeddingMatrix.length !== selectedRows.length) {
    console.warn('[explorer] Embedding row count mismatch', embeddingMatrix.length, 'vs selected', selectedRows.length);
  }
  const model = await loadModelIfNeeded();
  if (!model) throw new Error('Failed to load model');
  const tf = await import('@tensorflow/tfjs'); await tf.ready();
  const dims = embeddingMatrix[0].length;
  updateEmbeddingPanel(90, 'Predicting…', `Embedding ${embeddingMatrix.length}×${dims}`);
  const tensor = tf.tensor2d(embeddingMatrix, [embeddingMatrix.length, dims]);
  const preds = model.predict(tensor);
  const predIndices = preds.argMax(-1).dataSync();
  selectedRows.forEach((r, idx) => {
    const labelIndex = predIndices[idx];
    r.__prediction = (state.labelNames && state.labelNames[labelIndex] !== undefined)
      ? state.labelNames[labelIndex]
      : `Class ${labelIndex}`;
  });
  tf.dispose([tensor, preds]);
  // Ensure prediction column exists & force a visual refresh immediately
  if (table && table.gridApi) {
    try {
      ensurePredictionColumn(table);
      // Force repaint for prediction cells
      table.gridApi.refreshCells({ force: true, columns: ['__prediction'] });
      if (table.gridApi.redrawRows) table.gridApi.redrawRows();
    } catch (e) {
      console.warn('[explorer] Unable to force refresh after predictions', e);
    }
  }
}

// Decide prediction path based on saved training mode
async function runPredictions() {
  const btn = document.getElementById('predictWithModel');
  if (state.predictionInProgress) {
    console.log('[explorer] 🔄 Prediction already in progress - ignoring new click');
    return;
  }
  state.predictionInProgress = true;
  if (btn) btn.disabled = true;
  try {
    if (!state.modelAvailable) { alert('No trained model found. Train a model first.'); return; }
    const table = state.tables.find(t => t.id === state.activeTableId);
    if (!table) { alert('No active table'); return; }
    if (!state.featureMapping || !state.featureMapping.inputFeatures.length) { alert('No feature mapping found.'); return; }
    const selectedRows = table.gridApi.getSelectedRows();
    if (!selectedRows || !selectedRows.length) { alert('No rows selected for prediction.'); return; }
    ensurePredictionColumn(table);
    const mode = getTrainingMode();
    console.log(`[explorer] 🔮 Predicting on ${selectedRows.length} row(s) using mode=${mode === '1' ? 'LLM embedding' : 'RAW'} modelStorage=${state.modelStorageUrl}`);
    if (mode === '1') {
      await runPredictionsEmbedding(table, selectedRows).catch(e => { throw e; });
    } else {
      await runPredictionsRaw(table, selectedRows);
    }
    table.gridApi.refreshCells({ force: true });
  } catch (e) {
    console.error('Prediction error:', e);
    alert('Error running predictions: ' + e.message);
  } finally {
    state.predictionInProgress = false;
    if (btn) btn.disabled = !state.modelAvailable;
  }
}

// Add a new table
async function addTable(name, url, datasetId, csvText = null) {
  try {
    state.tableCounter++;
    const tableId = `table_${state.tableCounter}`;
    
    // Load data - use provided CSV text if available, otherwise fetch from URL
    let data;
    if (csvText) {
      console.log(`📤 Processing uploaded CSV for ${name}...`);
      data = await datasetManager.parseCSV(csvText, datasetId);
      console.log(`✅ Uploaded CSV parsed: ${data.length} rows`);
    } else {
      console.log(`🔗 Loading CSV from URL for ${name}: ${url}`);
      data = await datasetManager.loadCSV(url, datasetId);
      console.log(`✅ CSV loaded from URL: ${data.length} rows`);
    }
    
    // Add internal unique ID to each row to handle different ID columns across datasets
    data = data.map((row, index) => ({
      __internalId: `${datasetId}_${index}`,
      ...row
    }));
    
    const columns = data.length > 0 ? Object.keys(data[0]).filter(col => col !== '__internalId') : [];
    
    // Create tab button with remove button
    const tabNav = document.getElementById('tabNavigation');
    const tabButton = document.createElement('button');
    tabButton.id = `tab_${tableId}`;
    tabButton.className = 'px-4 py-2 text-gray-600 hover:text-gray-900 transition-all flex items-center gap-2';
    tabButton.dataset.tableId = tableId;
    
    // Tab name
    const tabName = document.createElement('span');
    tabName.textContent = name;
    tabButton.appendChild(tabName);
    
    // Remove button (×)
    const removeBtn = document.createElement('span');
    removeBtn.textContent = '×';
    removeBtn.className = 'label-remove-btn';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent switching to tab when clicking remove
      removeTable(tableId);
    });
    tabButton.appendChild(removeBtn);
    
    // Switch to tab when clicking the tab itself
    tabButton.addEventListener('click', () => switchTable(tableId));
    
    tabNav.appendChild(tabButton);
    
    // Create tab content (same as data.html)
    const tabContents = document.getElementById('tabContents');
    const tabContent = document.createElement('div');
    tabContent.id = `content_${tableId}`;
    tabContent.className = 'tab-content w-full';
    
    const gridContainer = document.createElement('div');
    gridContainer.id = `grid_${tableId}`;
    gridContainer.className = 'ag-theme-alpine w-full grid-container';
    
    tabContent.appendChild(gridContainer);
    tabContents.appendChild(tabContent);
    
    // Create grid with feature mapping
    const columnDefs = createColumnDefs(data, name);
    const gridOptions = {
      columnDefs,
      defaultColDef: {
        sortable: true,
        filter: true,
        resizable: true,
        editable: false
      },
      rowSelection: 'multiple',
      suppressRowClickSelection: true,
      pagination: true,
      paginationPageSize: 50,
      paginationPageSizeSelector: [25, 50, 100, 200],
      rowData: data,
      onSelectionChanged: () => {
        updateSelectionCount(tableId);
      }
    };
    
    const gridApi = createGrid(gridContainer, gridOptions);
    
    // Add to state
    state.tables.push({
      id: tableId,
      name,
      datasetId,
      gridApi,
      data,
      columns,
      selectedRows: [],
      url // Store URL for persistence
    });
    
    // Save to persistent storage
    await dataStore.savePersistentTable({
      datasetId,
      name,
      url,
      columns,
      rowCount: data.length
    });
    
    console.log('\u2705 Table saved to persistent storage:', name);
    
    // Update empty state
    updateEmptyState();
    
    // Switch to new table
    switchTable(tableId);
    
    return tableId;
  } catch (error) {
    console.error('Error adding table:', error);
    alert('Error loading table: ' + error.message);
    return null;
  }
}

// Switch active table
function switchTable(tableId) {
  // Update active state
  state.activeTableId = tableId;
  
  // Update tab buttons
  document.querySelectorAll('#tabNavigation button').forEach(btn => {
    btn.classList.remove('active-tab');
  });
  document.getElementById(`tab_${tableId}`).classList.add('active-tab');
  
  // Update tab contents
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`content_${tableId}`).classList.add('active');
  
  // Update title
  const table = state.tables.find(t => t.id === tableId);
  document.getElementById('tableTitle').textContent = table.name;
  
  // Update selection count
  updateSelectionCount(tableId);
  updateTotalSelectionCount();
}

// Clear training selection for a specific table
async function clearTrainingSelectionForTable(datasetId) {
  try {
    const selection = await dataStore.getTrainingSelection();
    if (!selection || !selection.tables) {
      return; // No selection to clean up
    }
    
    // Filter out the removed table from training selection
    const updatedTables = selection.tables.filter(t => t.datasetId !== datasetId);
    
    if (updatedTables.length !== selection.tables.length) {
      // Save updated selection
      await dataStore.saveTrainingSelection({ tables: updatedTables });
      console.log('\u2705 Training selection cleaned up for table:', datasetId);
    }
  } catch (error) {
    console.error('Error cleaning up training selection:', error);
    // Don't throw - table removal should continue even if cleanup fails
  }
}

// Clean up feature mappings for a removed table
async function cleanupFeatureMappings(tableName) {
  try {
    const mappingData = await dataStore.getFeatureMapping();
    if (!mappingData || !mappingData.mapping) {
      return; // No mapping to clean up
    }
    
    const mapping = mappingData.mapping;
    let modified = false;
    
    // Clean up input features
    if (mapping.inputFeatures && Array.isArray(mapping.inputFeatures)) {
      mapping.inputFeatures.forEach(feature => {
        if (feature.columns && Array.isArray(feature.columns)) {
          const originalLength = feature.columns.length;
          feature.columns = feature.columns.filter(col => col.tableName !== tableName);
          if (feature.columns.length < originalLength) {
            modified = true;
          }
        }
      });
    }
    
    // Clean up output feature
    if (mapping.outputFeature && mapping.outputFeature.columns && Array.isArray(mapping.outputFeature.columns)) {
      const originalLength = mapping.outputFeature.columns.length;
      mapping.outputFeature.columns = mapping.outputFeature.columns.filter(col => col.tableName !== tableName);
      if (mapping.outputFeature.columns.length < originalLength) {
        modified = true;
      }
    }
    
    // Save updated mapping if modified
    if (modified) {
      await dataStore.saveFeatureMapping(mapping);
      console.log('\u2705 Feature mappings cleaned up for table:', tableName);
    }
  } catch (error) {
    console.error('Error cleaning up feature mappings:', error);
    // Don't throw - table removal should continue even if cleanup fails
  }
}

// Remove current table
async function removeTable(tableId) {
  const index = state.tables.findIndex(t => t.id === tableId);
  if (index === -1) return;
  
  const table = state.tables[index];
  
  // Confirm deletion
  const confirmMsg = `Are you sure you want to remove the table "${table.name}"?\n\nThis will:\n- Remove the table from this workspace\n- Delete all cached data for this table\n- Cannot be undone\n\nContinue?`;
  
  if (!confirm(confirmMsg)) {
    return;
  }
  
  try {
    // Remove from persistent storage
    await dataStore.deletePersistentTable(table.datasetId);
    console.log('\u2705 Table removed from persistent storage:', table.name);
    
    // Clean up feature mappings that reference this table
    await cleanupFeatureMappings(table.name);
    
    // Clear training selection data for this table
    await clearTrainingSelectionForTable(table.datasetId);
    
    // Remove from DOM
    document.getElementById(`tab_${tableId}`).remove();
    document.getElementById(`content_${tableId}`).remove();
    
    // Remove from state
    state.tables.splice(index, 1);
    
    // Switch to first table if exists
    if (state.tables.length > 0) {
      switchTable(state.tables[0].id);
    } else {
      state.activeTableId = null;
      document.getElementById('tableTitle').textContent = 'No Tables';
      document.getElementById('selectedCount').textContent = '0 selected';
      document.getElementById('sendToTraining').disabled = true;
    }
    
    // Update empty state guide
    updateEmptyState();
    updateTotalSelectionCount();
  } catch (error) {
    console.error('Error removing table:', error);
    alert('Error removing table: ' + error.message);
  }
}

// Update selection count for a table
function updateSelectionCount(tableId) {
  const table = state.tables.find(t => t.id === tableId);
  if (!table) return;
  
  const selected = table.gridApi.getSelectedRows();
  table.selectedRows = selected;
  
  if (tableId === state.activeTableId) {
    document.getElementById('selectedCount').textContent = `${selected.length} selected`;
  }
  
  updateTotalSelectionCount();
}

// Update total selection count across all tables
function updateTotalSelectionCount() {
  const totalCount = state.tables.reduce((sum, t) => sum + t.selectedRows.length, 0);
  document.getElementById('totalSelectionCount').textContent = 
    totalCount > 0 ? `Total: ${totalCount} rows from ${state.tables.length} table(s)` : '';
  
  document.getElementById('sendToTraining').disabled = totalCount === 0;
}

// Send to training with auto-setup for presets
async function sendToTrainingWithAutoSetup(presetKey, autoSetupConfig) {
  console.log(`🎯 Auto-setup training for ${presetKey} preset`);
  
  if (state.tables.length === 0) {
    alert('No tables loaded!');
    return;
  }
  
  // Filter to only include tables with selected rows
  const tablesWithData = state.tables.filter(table => table.selectedRows.length > 0);
  
  if (tablesWithData.length === 0) {
    alert('No rows selected!');
    return;
  }
  
  console.log(`📊 Preparing ${tablesWithData.length} table(s) with data`);
  
  const tablesData = tablesWithData.map((table, index) => {
    const selectedIds = table.selectedRows.map(row => row.__internalId);
    const selectedRecords = table.selectedRows;
    
    return {
      datasetId: table.datasetId,
      selectedIds,
      selectedRecords,
      columns: table.columns,
      tabName: table.name,
      tabOrder: index
    };
  });
  
  try {
    console.log('🎯 Applying auto-setup feature mapping...');
    
    // Create feature mapping in the same format as mapping.js
    // Build base feature mapping
    const featureMapping = {
      inputFeatures: autoSetupConfig.featureColumns.map(columnName => ({
        columns: tablesData.map((table, tableIndex) => ({
          tableIndex: tableIndex,
          columnName: columnName,
          tableName: table.tabName
        }))
      })),
      outputFeature: {
        columns: tablesData.map((table, tableIndex) => ({
          tableIndex: tableIndex,
          columnName: autoSetupConfig.labelColumn,
          tableName: table.tabName
        }))
      },
      labelMapping: null,
      tableOrder: tablesData.map(t => t.tabName)
    };

    // Apply Kepler preset label collapsing if kepler
    if (presetKey === 'kepler') {
      try {
        // Collect unique disposition values from first table's selected records (others assumed aligned)
        const rawValuesSet = new Set();
        const labelCol = autoSetupConfig.labelColumn;
        tablesData.forEach(t => {
          // each t.selectedRecords contains full row objects
          t.selectedRecords.forEach(r => {
            const v = r[labelCol];
            if (v !== undefined && v !== null && v !== '') {
              rawValuesSet.add(String(v).trim());
            }
          });
        });
        const uniqueValues = Array.from(rawValuesSet).sort();
        // Use preset-defined labelGroups (moved from inline logic)
        const groups = Array.isArray(autoSetupConfig.labelGroups) ? autoSetupConfig.labelGroups : [];
        const targetLabels = [];
        let labelCounter = 0;
        groups.forEach(g => {
          // Only include values actually present in data
            const present = g.values.filter(v => rawValuesSet.has(v));
            if (present.length) {
              targetLabels.push({ id: `label_${++labelCounter}`, name: g.name, mappedValues: present });
            }
        });
        if (targetLabels.length) {
          featureMapping.labelMapping = { uniqueValues, targetLabels };
          console.log('🪐 Applied Kepler label grouping from preset config:', featureMapping.labelMapping);
        } else {
          console.log('⚠️ No preset label groups matched present values. uniqueValues:', uniqueValues);
        }
      } catch (e) {
        console.warn('Kepler preset label collapse failed:', e);
      }
    }
    
    console.log(`✅ Auto-mapped ${autoSetupConfig.featureColumns.length} input features`);
    console.log(`📋 Features: ${autoSetupConfig.featureColumns.join(', ')}`);
    console.log(`🏷️  Label: ${autoSetupConfig.labelColumn}`);
    
    // Save feature mapping
    await dataStore.saveFeatureMapping(featureMapping);
    
    // Save training selection
    await dataStore.saveTrainingSelection({ tables: tablesData });
    
    console.log('✅ Auto-setup complete - navigating to mapping.html...');
    
    // Navigate to feature mapping page
    window.location.href = 'mapping.html';
    
  } catch (e) {
    console.error('❌ Error in auto-setup:', e);
    console.error('Error stack:', e.stack);
    alert('Error in auto-setup: ' + e.message);
  }
}

// Send to training
async function sendToTraining() {
  console.log('🚀 sendToTraining called');
  console.log('Current state:', state);
  
  if (state.tables.length === 0) {
    alert('No tables loaded!');
    return;
  }
  
  // First, filter to only include tables with selected rows
  const tablesWithData = state.tables.filter(table => table.selectedRows.length > 0);
  
  if (tablesWithData.length === 0) {
    alert('No rows selected! Please select rows from at least one table.');
    return;
  }
  
  console.log(`📊 Preparing ${tablesWithData.length} table(s) with data (out of ${state.tables.length} total)`);
  
  const tablesData = tablesWithData.map((table, index) => {
    // Use internal ID for consistent identification across different datasets
    const selectedIds = table.selectedRows.map(row => row.__internalId);
    
    // Also save the actual row data to IndexedDB for later retrieval
    const selectedRecords = table.selectedRows;
    
    console.log(`📊 Table ${index} (${table.name}):`, {
      datasetId: table.datasetId,
      selectedCount: selectedRecords.length,
      firstRecordId: selectedRecords[0]?.__internalId,
      firstRecordSample: selectedRecords[0]
    });
    
    return {
      datasetId: table.datasetId,
      selectedIds,
      selectedRecords, // Include full records for storage
      columns: table.columns,
      tabName: table.name,
      tabOrder: index // Critical: preserve tab order (re-indexed after filtering)
    };
  });
  
  console.log('Preparing to save training selection...');
  console.log('Tables data (without full records):', tablesData.map(t => ({
    datasetId: t.datasetId,
    selectedIds: t.selectedIds.slice(0, 5), // Show first 5 IDs
    recordCount: t.selectedRecords.length,
    tabName: t.tabName
  })));
  
  try {
    console.log('🔄 Resetting feature mapping and label assignments...');
    
    // Clear all existing feature mappings and label assignments to start fresh
    await dataStore.saveFeatureMapping({
      inputFeatures: [],
      outputFeature: { columns: [] },
      labelMapping: null,
      tableOrder: tablesData.map(t => t.tabName)
    });
    
    console.log('✅ Cleared previous feature mappings');
    console.log('Calling dataStore.saveTrainingSelection...');
    await dataStore.saveTrainingSelection({ tables: tablesData });
    
    console.log('✅ Saved training snapshot with', tablesData.length, 'table(s) containing data');
    console.log('📋 Training snapshot tables:', tablesData.map(t => `${t.tabName} (${t.selectedIds.length} rows)`).join(', '));
    
    // Check storage
    const estimate = await dataStore.getStorageEstimate();
    if (estimate) {
      console.log('Storage used:', (estimate.usage / 1024 / 1024).toFixed(2), 'MB');
    }
    
    const totalRows = tablesData.reduce((sum, t) => sum + t.selectedIds.length, 0);
    console.log(`📸 Training snapshot created: ${tablesData.length} table(s), ${totalRows} total rows`);
    console.log('🔒 This snapshot is now isolated from Data Explorer changes');
    
    console.log('Navigating to mapping.html...');
    // Navigate to feature mapping page
    window.location.href = 'mapping.html';
  } catch (e) {
    console.error('❌ Error saving training selection:', e);
    console.error('Error stack:', e.stack);
    alert('Error saving training selection: ' + e.message);
  }
}

// Modal state
let currentUploadMode = 'url'; // 'url', 'upload', or 'preset'
let uploadedFile = null;

// Modal handlers
document.getElementById('addTableBtn').addEventListener('click', () => {
  document.getElementById('addTableModal').classList.remove('hidden');
  document.getElementById('tableNameInput').value = '';
  document.getElementById('csvUrlInput').value = '';
  document.getElementById('uploadFileName').textContent = '';
  uploadedFile = null;
  
  // Reset to URL tab
  switchUploadMode('url');
});

document.getElementById('cancelAddTable').addEventListener('click', () => {
  document.getElementById('addTableModal').classList.add('hidden');
});

// Kepler Preset Button Handler
document.getElementById('keplerPresetBtn').addEventListener('click', async () => {
  try {
    const preset = PRESETS.kepler;
    const name = preset.name;
    const url = preset.url;
    const datasetId = `dataset_${Date.now()}`;
    
    // Close modal immediately
    document.getElementById('addTableModal').classList.add('hidden');
    
    console.log('🪐 Kepler preset selected - loading data...');
    
    // Load the table
    const tableId = await addTable(name, url, datasetId, null);
    
    // Auto-setup with Kepler configuration
    if (tableId && preset.autoSetup) {
      console.log('🎯 Triggering auto-setup...');
      
      // Select all rows automatically
      const table = state.tables.find(t => t.id === tableId);
      if (table && table.gridApi) {
        table.gridApi.selectAll();
        updateSelectionCount(tableId);
        updateTotalSelectionCount();
        
        // Small delay to ensure selection is processed
        setTimeout(async () => {
          await sendToTrainingWithAutoSetup('kepler', preset.autoSetup);
        }, 100);
      }
    }
  } catch (error) {
    console.error('Error loading Kepler preset:', error);
    alert('Error loading Kepler preset: ' + error.message);
  }
});

// TESS Preset Button Handler
document.getElementById('tessPresetBtn').addEventListener('click', async () => {
  try {
    const preset = PRESETS.tess;
    const name = preset.name;
    const url = preset.url;
    const datasetId = `dataset_${Date.now()}`;
    
    // Close modal immediately
    document.getElementById('addTableModal').classList.add('hidden');
    
    console.log('🛰️ TESS preset selected - loading data...');
    
    // Load the table (no auto-setup for TESS yet)
    await addTable(name, url, datasetId, null);
    
    // If TESS has auto-setup in the future, add it here
    if (preset.autoSetup) {
      const table = state.tables.find(t => t.id === state.activeTableId);
      if (table && table.gridApi) {
        table.gridApi.selectAll();
        updateSelectionCount(state.activeTableId);
        updateTotalSelectionCount();
        
        setTimeout(async () => {
          await sendToTrainingWithAutoSetup('tess', preset.autoSetup);
        }, 100);
      }
    }
  } catch (error) {
    console.error('Error loading TESS preset:', error);
    alert('Error loading TESS preset: ' + error.message);
  }
});

// Tab switching in modal
function switchUploadMode(mode) {
  currentUploadMode = mode;
  
  // Update tab styles
  const tabs = {
    url: document.getElementById('urlTab'),
    upload: document.getElementById('uploadTab')
  };
  
  const sections = {
    url: document.getElementById('urlSection'),
    upload: document.getElementById('uploadSection')
  };
  
  // Reset all tabs
  Object.values(tabs).forEach(tab => {
    tab.className = 'px-4 py-2 text-gray-400 hover:text-gray-200';
  });
  
  // Hide all sections
  Object.values(sections).forEach(section => {
    section.classList.add('hidden');
  });
  
  // Activate selected tab
  tabs[mode].className = 'px-4 py-2 border-b-2 border-blue-500 text-blue-400 font-medium';
  sections[mode].classList.remove('hidden');
  
  // Setup drag and drop when switching to upload tab
  if (mode === 'upload') {
    console.log('📤 Switched to upload tab');
    // Use setTimeout to ensure DOM is rendered
    setTimeout(() => {
      initializeDragDrop();
    }, 100);
  }
}

document.getElementById('urlTab').addEventListener('click', () => switchUploadMode('url'));
document.getElementById('uploadTab').addEventListener('click', () => switchUploadMode('upload'));

// Unified file selection handler
function handleFileSelection(file) {
  console.log('📎 File selected:', file.name, file.size, 'bytes');
  uploadedFile = file;
  document.getElementById('uploadFileName').textContent = `Selected: ${file.name}`;
  
  // Auto-fill table name if empty
  if (!document.getElementById('tableNameInput').value) {
    const nameWithoutExt = file.name.replace(/\.csv$/i, '');
    document.getElementById('tableNameInput').value = nameWithoutExt;
    console.log('✏️ Auto-filled table name:', nameWithoutExt);
  }
}

// File upload handler (for click/browse)
document.getElementById('csvFileInput').addEventListener('change', (e) => {
  console.log('📂 File input changed');
  const file = e.target.files[0];
  if (file) {
    handleFileSelection(file);
  }
});

// Prevent default drag behaviors
function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

// Setup drag and drop handlers - use event delegation to avoid issues with hidden elements
let dragDropInitialized = false;

function initializeDragDrop() {
  if (dragDropInitialized) {
    console.log('⚠️ Drag and drop already initialized');
    return;
  }
  
  console.log('🎯 Initializing drag and drop...');
  
  // Get the drop zone (the label inside uploadSection)
  const uploadSection = document.getElementById('uploadSection');
  
  if (!uploadSection) {
    console.error('❌ uploadSection not found!');
    return;
  }
  
  // Use event delegation on the uploadSection itself
  const dropZone = uploadSection.querySelector('.border-dashed');
  
  if (!dropZone) {
    console.error('❌ Drop zone (border-dashed element) not found!');
    return;
  }
  
  console.log('✅ Found drop zone:', dropZone);
  
  // Prevent default drag behaviors
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });
  
  // Highlight drop zone when dragging over it
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      console.log('🎨 Drag over detected');
      dropZone.classList.add('border-indigo-500', 'bg-indigo-50');
    }, false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      console.log('🎨 Drag leave/drop detected');
      dropZone.classList.remove('border-indigo-500', 'bg-indigo-50');
    }, false);
  });
  
  // Handle dropped files
  dropZone.addEventListener('drop', (e) => {
    console.log('🎯 Drop detected!');
    const dt = e.dataTransfer;
    const files = dt.files;
    
    console.log('📦 Files dropped:', files.length);
    
    if (files.length > 0) {
      const file = files[0];
      console.log('📄 File:', file.name, file.type);
      
      // Check if it's a CSV file
      if (!file.name.toLowerCase().endsWith('.csv')) {
        alert('Please upload a CSV file');
        return;
      }
      
      handleFileSelection(file);
    }
  }, false);
  
  dragDropInitialized = true;
  console.log('✅ Drag and drop initialized successfully');
}

document.getElementById('confirmAddTable').addEventListener('click', async () => {
  const name = document.getElementById('tableNameInput').value.trim();
  
  if (!name) {
    alert('Please provide a table name');
    return;
  }
  
  const datasetId = `dataset_${Date.now()}`;
  let url = null;
  let csvText = null;
  
  try {
    if (currentUploadMode === 'url') {
      url = document.getElementById('csvUrlInput').value.trim();
      if (!url) {
        alert('Please provide a CSV URL');
        return;
      }
    } else if (currentUploadMode === 'upload') {
      if (!uploadedFile) {
        alert('Please select a file to upload');
        return;
      }
      // Read file content
      csvText = await readFileAsText(uploadedFile);
      url = `uploaded://${uploadedFile.name}`; // Virtual URL for storage
    }
    
    document.getElementById('addTableModal').classList.add('hidden');
    
    // Load the table with CSV text if uploaded, otherwise use URL
    await addTable(name, url, datasetId, csvText);
    
  } catch (error) {
    console.error('Error adding table:', error);
    alert('Error adding table: ' + error.message);
  }
});

// Helper function to read file as text
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}

document.getElementById('sendToTraining').addEventListener('click', sendToTraining);
// Prediction button listener
const predictBtn = document.getElementById('predictWithModel');
if (predictBtn) {
  predictBtn.addEventListener('click', runPredictions);
}

// Show/hide empty state guide
function updateEmptyState() {
  const emptyGuide = document.getElementById('emptyStateGuide');
  const tabContents = document.getElementById('tabContents');
  
  if (state.tables.length === 0) {
    // Show guide
    emptyGuide.classList.remove('hidden');
    // Hide all table content divs
    Array.from(tabContents.querySelectorAll('.tab-content')).forEach(el => {
      el.style.display = 'none';
    });
  } else {
    // Hide guide
    emptyGuide.classList.add('hidden');
  }
}

// Load all persistent tables from database
async function loadPersistentTables() {
  try {
    const tables = await dataStore.getAllPersistentTables();
    console.log('\uD83D\uDCE6 Found', tables.length, 'persistent table(s)');
    
    if (tables.length === 0) {
      // No tables - show empty state guide
      console.log('No persistent tables found. Use "+ Add Table" to load data.');
      document.getElementById('tableTitle').textContent = 'No Tables';
      document.getElementById('sendToTraining').disabled = true;
      updateEmptyState();
    } else {
      // Load all persistent tables
      for (const table of tables) {
        await addTable(table.name, table.url, table.datasetId);
      }
      updateEmptyState();
    }
  } catch (error) {
    console.error('Error loading persistent tables:', error);
    document.getElementById('tableTitle').textContent = 'Error Loading Tables';
  }
}

// Refresh column headers with feature mapping
async function refreshFeatureMapping() {
  const hasMapping = await loadFeatureMapping();
  
  if (hasMapping) {
    // Refresh all grids with updated column definitions
    state.tables.forEach(table => {
      const columnDefs = createColumnDefs(table.data, table.name);
      table.gridApi.setGridOption('columnDefs', columnDefs);
    });
    
    console.log('\u2705 Feature mapping applied to column headers');
  }
}

// Reload feature mapping when window regains focus (user returns from another page)
window.addEventListener('focus', async () => {
  console.log('\uD83D\uDD04 Window focused - checking for mapping updates...');
  const previousMapping = JSON.stringify(state.featureMapping);
  await loadFeatureMapping();
  const newMapping = JSON.stringify(state.featureMapping);
  
  // Only refresh if mapping actually changed
  if (previousMapping !== newMapping) {
    console.log('\uD83D\uDD04 Feature mapping changed - refreshing column headers...');
    await refreshFeatureMapping();
  }
});

// Prevent default drag and drop on the whole document (except in modal)
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  document.addEventListener(eventName, (e) => {
    // Allow drag and drop in the upload modal
    if (e.target.closest('#uploadSection')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }, false);
});

// Initialize
(async () => {
  console.log('\uD83D\uDE80 Initializing Multi-Table Explorer...');
  
  // Load feature mapping first
  await loadFeatureMapping();
  // Detect existing model to enable prediction button
  await detectModel();
  
  // Load persistent tables
  await loadPersistentTables();
  
  // Refresh feature mapping on columns
  await refreshFeatureMapping();
  
  console.log('\u2705 Multi-Table Explorer initialized');
})();
