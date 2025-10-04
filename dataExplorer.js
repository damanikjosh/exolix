import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { createGrid } from 'ag-grid-community';
import { parse } from 'csv-parse/lib/sync';
import dataStore from './dataStore.js';

ModuleRegistry.registerModules([AllCommunityModule]);

let gridApi = null;
let allData = [];
const DATASET_ID = 'cumulative_2025';

// Parse CSV data
async function loadData() {
  try {
    // Try to load from IndexedDB first
    const cachedRecords = await dataStore.getAllRecords(DATASET_ID);
    
    if (cachedRecords && cachedRecords.length > 0) {
      console.log('Loaded data from IndexedDB cache:', cachedRecords.length, 'records');
      return cachedRecords;
    }
    
    // If not cached, fetch from server
    console.log('Fetching data from server...');
    const response = await fetch('static/cumulative_2025.09.29_21.37.15.csv');
    const text = await response.text();
    
    // Save raw CSV to IndexedDB
    await dataStore.saveCsvData('cumulative_2025.09.29_21.37.15.csv', text);
    
    // Parse CSV, skipping comment lines
    const lines = text.split('\n').filter(line => !line.startsWith('#') && line.trim());
    const csvText = lines.join('\n');
    
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      cast: (value, context) => {
        if (value === '') return null;
        const num = Number(value);
        return isNaN(num) ? value : num;
      }
    });
    
    // Save parsed records to IndexedDB for future use
    console.log('Caching parsed records to IndexedDB...');
    await dataStore.saveRecords(records, DATASET_ID);
    console.log('Data cached successfully');
    
    return records;
  } catch (error) {
    console.error('Error loading data:', error);
    return [];
  }
}

// Define columns for key fields
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
  },
  { field: 'kepid', headerName: 'KepID', width: 100, pinned: 'left' },
  { field: 'kepoi_name', headerName: 'KOI Name', width: 120, pinned: 'left' },
  { field: 'kepler_name', headerName: 'Kepler Name', width: 150 },
  { field: 'koi_disposition', headerName: 'Disposition', width: 140, 
    cellStyle: params => {
      if (params.value === 'CONFIRMED') return { backgroundColor: '#d4edda', color: '#155724' };
      if (params.value === 'FALSE POSITIVE') return { backgroundColor: '#f8d7da', color: '#721c24' };
      if (params.value === 'CANDIDATE') return { backgroundColor: '#fff3cd', color: '#856404' };
      return null;
    }
  },
  { field: 'koi_pdisposition', headerName: 'P Disposition', width: 140 },
  { field: 'koi_score', headerName: 'Score', width: 90 },
  { field: 'koi_period', headerName: 'Orbital Period (days)', width: 150 },
  { field: 'koi_duration', headerName: 'Transit Duration (hrs)', width: 160 },
  { field: 'koi_depth', headerName: 'Transit Depth (ppm)', width: 150 },
  { field: 'koi_prad', headerName: 'Planetary Radius (Earth)', width: 180 },
  { field: 'koi_teq', headerName: 'Eq. Temperature (K)', width: 160 },
  { field: 'koi_insol', headerName: 'Insolation (Earth flux)', width: 170 },
  { field: 'koi_steff', headerName: 'Stellar Temp (K)', width: 140 },
  { field: 'koi_slogg', headerName: 'Stellar Gravity', width: 130 },
  { field: 'koi_srad', headerName: 'Stellar Radius (Solar)', width: 170 },
  { field: 'ra', headerName: 'RA (deg)', width: 100 },
  { field: 'dec', headerName: 'Dec (deg)', width: 100 }
];

// Grid options
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
  onGridReady: async (params) => {
    gridApi = params.api;
    
    // Load data
    allData = await loadData();
    gridApi.setGridOption('rowData', allData);
    
    updateSelectionCount();
  },
  onSelectionChanged: () => {
    updateSelectionCount();
  }
};

// Update selection count
function updateSelectionCount() {
  if (!gridApi) return;
  const selected = gridApi.getSelectedRows();
  const countEl = document.getElementById('selectedCount');
  const btn = document.getElementById('sendToTraining');
  
  countEl.textContent = `${selected.length} selected`;
  btn.disabled = selected.length === 0;
}

// Send to training
document.getElementById('sendToTraining').addEventListener('click', async () => {
  const selected = gridApi.getSelectedRows();
  
  if (selected.length === 0) {
    alert('Please select at least one row');
    return;
  }
  
  // Store selection in IndexedDB
  const selectedIds = selected.map(row => row.kepid);
  
  try {
    await dataStore.saveTrainingSelection({
      selectedIds,
      datasetId: DATASET_ID
    });
    
    console.log('Saved training selection:', selectedIds.length, 'records');
    
    // Check storage estimate
    const estimate = await dataStore.getStorageEstimate();
    if (estimate) {
      console.log('Storage used:', (estimate.usage / 1024 / 1024).toFixed(2), 'MB');
      console.log('Storage quota:', (estimate.quota / 1024 / 1024).toFixed(2), 'MB');
    }
    
    // Navigate to training page
    window.location.href = 'training.html';
  } catch (e) {
    alert('Error saving training selection: ' + e.message);
    console.error('Error saving selection:', e);
  }
});

// Initialize grid
const gridContainer = document.getElementById('gridContainer');
createGrid(gridContainer, gridOptions);
