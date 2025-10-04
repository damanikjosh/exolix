# IndexedDB Data Storage Implementation

## Overview
ExoLiX now uses **IndexedDB** for client-side data storage, which provides:
- **Large storage capacity** (50MB+ or unlimited with permission)
- **Fast data access** (no need to re-fetch CSV files)
- **Support for multiple datasets** (Kepler, K2, TESS, etc.)
- **Persistent storage** (data survives page reloads and browser restarts)

## Architecture

### Files Created
1. **`dataStore.js`** - IndexedDB wrapper with three stores:
   - `trainingSelections` - Stores selected row IDs for training
   - `csvData` - Stores raw CSV file content
   - `records` - Stores parsed data records

2. **`datasetManager.js`** - High-level dataset management utility

### How It Works

#### Data Explorer Flow
```javascript
// 1. Load data (from cache or server)
loadData() → checks IndexedDB → fetches if needed → caches parsed records

// 2. User selects rows
// 3. Click "Send to Training"
saveTrainingSelection() → stores only kepid values in IndexedDB

// 4. Navigate to training page
```

#### Training Page Flow
```javascript
// 1. Load training selection from IndexedDB
getTrainingSelection() → retrieves selected IDs

// 2. Load full records from IndexedDB
getRecordsByIds() → retrieves complete data for selected IDs

// 3. No server fetch needed - everything from IndexedDB
```

## Benefits vs SessionStorage

| Feature | SessionStorage | IndexedDB |
|---------|---------------|-----------|
| Size Limit | ~5-10 MB | 50 MB - unlimited |
| Persistence | Session only | Survives browser restart |
| Performance | Slower for large data | Faster with indexing |
| Multiple Datasets | Difficult | Easy |

## Usage

### Loading a Dataset
```javascript
import datasetManager from './datasetManager.js';

// Load and cache a CSV file
const data = await datasetManager.loadCSV(
  'static/cumulative_2025.09.29_21.37.15.csv',
  'cumulative_2025'
);
```

### Saving Training Selection
```javascript
import dataStore from './dataStore.js';

await dataStore.saveTrainingSelection({
  selectedIds: [10187017, 10187159, ...],
  datasetId: 'cumulative_2025'
});
```

### Loading Training Data
```javascript
// Get selection
const selection = await dataStore.getTrainingSelection();

// Get full records
const trainingData = await dataStore.getRecordsByIds(
  selection.selectedIds,
  selection.datasetId
);
```

### Storage Management
```javascript
// Check storage usage
const info = await datasetManager.getStorageInfo();
console.log(`Using ${info.usedMB} MB of ${info.quotaMB} MB (${info.percentUsed}%)`);

// List cached datasets
const datasets = await datasetManager.listDatasets();

// Clear a dataset
await datasetManager.clearDataset('cumulative_2025');

// Clear everything
await dataStore.clearAll();
```

## Adding More Datasets

To add support for K2, TESS, or other missions:

```javascript
// In your data explorer
const DATASETS = {
  kepler: {
    id: 'cumulative_2025',
    url: 'static/cumulative_2025.09.29_21.37.15.csv',
    name: 'Kepler Cumulative'
  },
  k2: {
    id: 'k2_data',
    url: 'static/k2_data.csv',
    name: 'K2 Mission'
  },
  tess: {
    id: 'tess_data',
    url: 'static/tess_data.csv',
    name: 'TESS Mission'
  }
};

// Switch dataset
async function switchDataset(datasetKey) {
  const dataset = DATASETS[datasetKey];
  const data = await datasetManager.loadCSV(dataset.url, dataset.id);
  gridApi.setGridOption('rowData', data);
}
```

## Browser Compatibility
- ✅ Chrome/Edge (full support)
- ✅ Firefox (full support)
- ✅ Safari (full support)
- ⚠️ Older browsers may have limited storage quotas

## Debugging

Open browser console to see:
- Cache hits/misses
- Storage usage
- Data loading progress

```javascript
// In browser console
const estimate = await navigator.storage.estimate();
console.log('Storage:', estimate);
```

## Performance Tips

1. **First load**: Data fetches from server and caches (~2-5 seconds)
2. **Subsequent loads**: Data loads from IndexedDB (~100-500ms)
3. **Large selections**: No quota issues, stores only IDs
4. **Multiple datasets**: Each cached independently

## Migration Notes

Your existing code will work automatically! The new system:
- Falls back to server fetch if cache is empty
- Automatically caches on first load
- Handles the old sessionStorage approach gracefully
