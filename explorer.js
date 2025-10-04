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
  featureMapping: null // Will be loaded from dataStore
};

// Load feature mapping from database
async function loadFeatureMapping() {
  try {
    const mappingData = await dataStore.getFeatureMapping();
    if (mappingData && mappingData.mapping) {
      state.featureMapping = mappingData.mapping;
      console.log('✅ Feature mapping loaded:', state.featureMapping);
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

// Presets for common datasets
const PRESETS = {
  kepler: {
    name: 'Kepler Object of Interest 2025',
    url: 'data/cumulative_2025.09.29_21.37.15.csv',
    datasetId: 'koi_2025'
  },
  tess: {
    name: 'TESS Object of Interest 2025',
    url: 'data/TOI_2025.10.01_18.37.10.csv',
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
    
    // Create tab button
    const tabNav = document.getElementById('tabNavigation');
    const tabButton = document.createElement('button');
    tabButton.id = `tab_${tableId}`;
    tabButton.className = 'px-4 py-2 text-gray-600 hover:text-gray-900 transition-all';
    tabButton.textContent = name;
    tabButton.dataset.tableId = tableId;
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
  
  // Always enable remove button (confirmation will be shown)
  document.getElementById('removeTableBtn').disabled = false;
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
  document.getElementById('presetSelect').value = '';
  document.getElementById('uploadFileName').textContent = '';
  uploadedFile = null;
  
  // Reset to URL tab
  switchUploadMode('url');
});

document.getElementById('cancelAddTable').addEventListener('click', () => {
  document.getElementById('addTableModal').classList.add('hidden');
});

// Tab switching in modal
function switchUploadMode(mode) {
  currentUploadMode = mode;
  
  // Update tab styles
  const tabs = {
    url: document.getElementById('urlTab'),
    upload: document.getElementById('uploadTab'),
    preset: document.getElementById('presetTab')
  };
  
  const sections = {
    url: document.getElementById('urlSection'),
    upload: document.getElementById('uploadSection'),
    preset: document.getElementById('presetSection')
  };
  
  // Reset all tabs
  Object.values(tabs).forEach(tab => {
    tab.className = 'px-4 py-2 text-gray-600 hover:text-gray-900';
  });
  
  // Hide all sections
  Object.values(sections).forEach(section => {
    section.classList.add('hidden');
  });
  
  // Activate selected tab
  tabs[mode].className = 'px-4 py-2 border-b-2 border-indigo-600 text-indigo-600 font-medium';
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
document.getElementById('presetTab').addEventListener('click', () => switchUploadMode('preset'));

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

document.getElementById('presetSelect').addEventListener('change', (e) => {
  const preset = PRESETS[e.target.value];
  if (preset) {
    document.getElementById('tableNameInput').value = preset.name;
  }
});

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
    } else if (currentUploadMode === 'preset') {
      const presetKey = document.getElementById('presetSelect').value;
      if (!presetKey) {
        alert('Please select a preset');
        return;
      }
      const preset = PRESETS[presetKey];
      url = preset.url;
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

document.getElementById('removeTableBtn').addEventListener('click', async () => {
  if (state.activeTableId) {
    await removeTable(state.activeTableId);
  }
});

document.getElementById('sendToTraining').addEventListener('click', sendToTraining);

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
  
  // Load persistent tables
  await loadPersistentTables();
  
  // Refresh feature mapping on columns
  await refreshFeatureMapping();
  
  console.log('\u2705 Multi-Table Explorer initialized');
})();
