# Multi-Table Feature Mapping System

## Overview
ExoLiX now supports **multi-table data exploration** with **flexible feature mapping** for neural network training. This allows users to combine columns from different CSV files into custom input features while maintaining strict data order consistency.

## Architecture

### 3-Step Workflow

```
Step 1: Multi-Table Data Explorer
   ↓
Step 2: Feature Mapping Interface  
   ↓
Step 3: Neural Network Training
```

---

## Step 1: Multi-Table Data Explorer

**File:** `multiTableExplorer.html` + `multiTableExplorer.js`

### Features
- ✅ **Tabbed interface** for multiple CSV files
- ✅ **Independent row selection** per table
- ✅ **Dynamic table addition/removal**
- ✅ **Table order preservation** (critical for feature mapping)
- ✅ **Preset datasets** (Kepler, K2, TESS)

### Usage

#### Adding Tables
1. Click "+ Add Table" button
2. Enter table name and CSV URL
3. Or select from presets
4. Table loads with AG Grid interface

#### Selecting Data
1. Switch between tabs to view different tables
2. Select rows independently in each table
3. See total selection count across all tables

#### Send to Training
- Click "Send to Training"
- Selections from **all tables** saved to IndexedDB
- **Table order is preserved** (tab order = data order)

### Data Structure Saved
```javascript
{
  tables: [
    {
      datasetId: 'cumulative_2025',
      selectedIds: [10187017, 10187159, ...],
      columns: ['kepid', 'koi_disposition', ...],
      tabName: 'Kepler Cumulative 2025',
      tabOrder: 0  // Critical: maintains order
    },
    {
      datasetId: 'k2_data',
      selectedIds: [...],
      columns: ['epic_id', 'disposition', ...],
      tabName: 'K2 Mission',
      tabOrder: 1
    }
  ]
}
```

---

## Step 2: Feature Mapping Interface

**File:** `featureMapping.html` + `featureMapping.js`

### Features
- ✅ **Drag-and-drop** column mapping
- ✅ **Multiple input features** (user-defined count)
- ✅ **Column combination** from different tables
- ✅ **Single output label**
- ✅ **Visual feedback** with color-coded chips
- ✅ **Table order respect** (critical)

### Interface Layout

```
┌─────────────────────────────────────────────────────────┐
│  Available Columns          │  Neural Network Features  │
│  (Left Panel)               │  (Right Panel)            │
├─────────────────────────────┼───────────────────────────┤
│  Table 1: Kepler            │  Input Feature 1          │
│  • kepid                    │  [Drop columns here]      │
│  • koi_disposition          │                           │
│  • koi_period               │  Input Feature 2          │
│                             │  [Drop columns here]      │
│  Table 2: K2                │                           │
│  • epic_id                  │  + Add Input Feature      │
│  • disposition              │                           │
│  • period                   │  ─────────────────        │
│                             │  Output Label             │
│                             │  [Drop column here]       │
└─────────────────────────────┴───────────────────────────┘
```

### Creating Features

#### Input Features
1. Click "+ Add Input Feature"
2. Drag columns from left panel
3. Drop into feature box
4. Can combine **multiple columns from different tables**
5. Columns are **automatically sorted by table order**

#### Example: Feature Combining
```javascript
Input Feature 1:
  - Table 1: koi_period
  - Table 2: period
  Result: Creates single feature combining both period columns

Input Feature 2:
  - Table 1: koi_depth
  - Table 1: koi_duration
  Result: Combines two columns from same table
```

#### Output Label
1. Drag **one column** to output section
2. Only single column allowed
3. Used as training label

### Feature Mapping Structure Saved
```javascript
{
  inputFeatures: [
    {
      columns: [
        { tableIndex: 0, columnName: 'koi_period', tableName: 'Kepler' },
        { tableIndex: 1, columnName: 'period', tableName: 'K2' }
      ]
    },
    {
      columns: [
        { tableIndex: 0, columnName: 'koi_depth', tableName: 'Kepler' }
      ]
    }
  ],
  outputFeature: {
    tableIndex: 0,
    columnName: 'koi_disposition',
    tableName: 'Kepler'
  },
  tableOrder: ['Kepler Cumulative 2025', 'K2 Mission']
}
```

---

## Step 3: Neural Network Training

**File:** `training.html` + Updated `training.js`

### Data Loading Process

```javascript
// 1. Load feature mapping
const mapping = await dataStore.getFeatureMapping();

// 2. Load training selection
const selection = await dataStore.getTrainingSelection();

// 3. Load actual data from IndexedDB
const allData = await Promise.all(
  selection.tables.map(async (table) => {
    return await dataStore.getRecordsByIds(
      table.selectedIds,
      table.datasetId
    );
  })
);

// 4. Align data by row (maintaining table order)
const alignedData = alignDataByRowIndex(allData);

// 5. Extract features according to mapping
const inputData = extractInputFeatures(alignedData, mapping.inputFeatures);
const outputData = extractOutputFeature(alignedData, mapping.outputFeature);
```

### Critical: Data Alignment

**Problem:** Different tables may have different row counts after selection.

**Solution:** Align by row index, ensuring consistent ordering.

```javascript
function alignDataByRowIndex(tableDataArray) {
  // Find minimum row count
  const minRows = Math.min(...tableDataArray.map(t => t.length));
  
  // Create aligned rows
  const aligned = [];
  for (let i = 0; i < minRows; i++) {
    aligned.push(
      tableDataArray.map(table => table[i])
    );
  }
  return aligned;
}
```

### Feature Extraction

```javascript
function extractInputFeatures(alignedData, inputFeatures) {
  return alignedData.map(row => {
    return inputFeatures.map(feature => {
      // Combine columns from different tables
      return feature.columns.map(col => {
        const tableData = row[col.tableIndex];
        return tableData[col.columnName];
      }).flat();
    }).flat();
  });
}
```

---

## Data Order Consistency ⚠️

### Critical Rule
**ALWAYS respect table order from Data Explorer tabs**

### Why It Matters
```
User creates features:
  Input 1: Table1.col1 + Table2.col1
  
If table order changes:
  ❌ Wrong: Table2.col1 + Table1.col1
  ✅ Correct: Table1.col1 + Table2.col1
```

### Implementation
1. **Tab Order:** Saved as `tabOrder` field (0, 1, 2, ...)
2. **Feature Mapping:** Columns sorted by `tableIndex`
3. **Data Loading:** Tables loaded in `tabOrder` sequence
4. **Row Alignment:** Maintains table order throughout

---

## Example Use Cases

### Use Case 1: Single Table, Multiple Features
```
Table: Kepler Data
Input 1: koi_period
Input 2: koi_depth + koi_duration (combined)
Output: koi_disposition
```

### Use Case 2: Multiple Tables, Column Matching
```
Table 1: Kepler
Table 2: TESS

Input 1: Kepler.koi_period + TESS.period
Input 2: Kepler.koi_depth + TESS.depth
Output: Kepler.koi_disposition
```

### Use Case 3: Different Column Names
```
Table 1: Old Format (kepid, disposition)
Table 2: New Format (epic_id, status)

Feature Mapping handles different schemas!
Input 1: Table1.kepid + Table2.epic_id
Output: Table1.disposition
```

---

## Testing Checklist

### Multi-Table Explorer
- [ ] Add multiple tables
- [ ] Select rows in each table
- [ ] Remove a table
- [ ] Verify tab order
- [ ] Send to training

### Feature Mapping
- [ ] Drag columns to input features
- [ ] Create multiple input features
- [ ] Combine columns from different tables
- [ ] Set output label
- [ ] Verify mapping summary
- [ ] Proceed to training

### Training
- [ ] Load feature mapping
- [ ] Load training data
- [ ] Verify data alignment
- [ ] Extract features correctly
- [ ] Maintain table order

---

## Files Summary

| File | Purpose |
|------|---------|
| `multiTableExplorer.html/js` | Multi-tab data selection |
| `featureMapping.html/js` | Drag-drop feature mapping |
| `dataStore.js` | IndexedDB operations |
| `datasetManager.js` | CSV loading & caching |
| `training.html/js` | Neural network training |

---

## Next Steps

1. **Test with real data**
2. **Add TensorFlow.js integration** to training page
3. **Implement data preprocessing** (normalization, encoding)
4. **Add model export/import**
5. **Visualization** of training progress

---

## Key Advantages

✅ **Flexible:** Mix any CSV files with any column names  
✅ **Consistent:** Strict table order preservation  
✅ **Intuitive:** Drag-and-drop interface  
✅ **Scalable:** IndexedDB handles large datasets  
✅ **Fast:** Cached data, no re-fetching  

**Status: Feature Complete! Ready for TensorFlow.js Integration** 🚀
