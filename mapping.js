import dataStore from './dataStore.js';

// State management
const state = {
  tables: [], // Array of {datasetId, columns, tabName, tabOrder, selectedIds}
  inputFeatures: [], // Array of {id, mappedColumns: [{tableIndex, columnName}]}
  outputFeature: null, // {columns: [{tableIndex, columnName}]}
  featureCounter: 0,
  labelMapping: null, // {uniqueValues: [], targetLabels: [{id, name, mappedValues: []}]}
  labelCounter: 0
};

// Load training selection from IndexedDB
async function loadTrainingData() {
  try {
    const selection = await dataStore.getTrainingSelection();
    
    if (!selection || !selection.tables || selection.tables.length === 0) {
      document.getElementById('dataInfo').innerHTML = `
        <p class="text-orange-600">No training data selected.</p>
        <p class="text-gray-600 mt-2">
          Please go to the <a href="explorer.html" class="link-primary">Explorer</a> 
          and select data from tables.
        </p>
      `;
      return false;
    }
    
    // Filter tables to only include those with selected data, then sort by tabOrder
    state.tables = selection.tables
      .filter(t => t.selectedIds && t.selectedIds.length > 0)
      .sort((a, b) => a.tabOrder - b.tabOrder);
    
    // Check if we have any tables with data after filtering
    if (state.tables.length === 0) {
      document.getElementById('dataInfo').innerHTML = `
        <p class="text-orange-600">No training data with selected rows found.</p>
        <p class="text-gray-600 mt-2">
          Please go to the <a href="explorer.html" class="link-primary">Explorer</a> 
          and select rows from at least one table.
        </p>
      `;
      return false;
    }
    
    // Display info
    const totalRows = state.tables.reduce((sum, t) => sum + t.selectedIds.length, 0);
    const tablesList = state.tables.map((t, i) => 
      `<li><strong>Table ${i + 1}:</strong> ${t.tabName} (${t.selectedIds.length} rows, ${t.columns.length} columns)</li>`
    ).join('');
    
    document.getElementById('dataInfo').innerHTML = `
      <p class="text-gray-700 mb-2"><strong>Total Rows:</strong> ${totalRows}</p>
      <p class="text-gray-700 mb-2"><strong>Tables (in order):</strong></p>
      <ul class="list-disc list-inside ml-4 text-gray-600">
        ${tablesList}
      </ul>
      <p class="text-sm text-blue-600 mt-3">
        ⚠️ Column order will follow the table order above
      </p>
      <p class="text-sm text-green-600 mt-2">
        📸 Working with training snapshot (isolated from Data Explorer)
      </p>
    `;
    
    // Populate available columns
    populateAvailableColumns();
    
    return true;
  } catch (error) {
    console.error('Error loading training data:', error);
    document.getElementById('dataInfo').innerHTML = `
      <p class="text-red-600">Error loading training data: ${error.message}</p>
    `;
    return false;
  }
}

// Check if a column is already assigned to any feature
function isColumnAssigned(tableIndex, columnName) {
  // Check input features
  for (const feature of state.inputFeatures) {
    if (feature.mappedColumns.some(c => c.tableIndex === tableIndex && c.columnName === columnName)) {
      return true;
    }
  }
  
  // Check output feature
  if (state.outputFeature && state.outputFeature.columns) {
    if (state.outputFeature.columns.some(c => c.tableIndex === tableIndex && c.columnName === columnName)) {
      return true;
    }
  }
  
  return false;
}

// Populate available columns panel
function populateAvailableColumns() {
  const container = document.getElementById('availableColumns');
  container.innerHTML = '';
  
  state.tables.forEach((table, tableIndex) => {
    const tableSection = document.createElement('div');
    tableSection.className = 'mb-4';
    
    const tableHeader = document.createElement('div');
    tableHeader.className = 'font-medium text-gray-700 mb-2 pb-2 border-b';
    tableHeader.textContent = `${table.tabName} (Table ${tableIndex + 1})`;
    tableSection.appendChild(tableHeader);
    
    const columnsContainer = document.createElement('div');
    columnsContainer.className = 'flex flex-wrap gap-2';
    
    // Filter out assigned columns
    const availableColumns = table.columns.filter(column => !isColumnAssigned(tableIndex, column));
    
    if (availableColumns.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'text-sm text-gray-400 italic';
      emptyMsg.textContent = 'All columns assigned';
      columnsContainer.appendChild(emptyMsg);
    } else {
      availableColumns.forEach(column => {
        const chip = document.createElement('div');
        chip.className = 'draggable bg-semi-light bg-blur px-3 py-1 text-gray-300 text-sm rounded-full border border-gray-700 hover:bg-gray-600';
        chip.textContent = column;
        chip.draggable = true;
        chip.dataset.tableIndex = tableIndex;
        chip.dataset.columnName = column;
        chip.dataset.tableName = table.tabName;
        
        // Drag events
        chip.addEventListener('dragstart', handleDragStart);
        chip.addEventListener('dragend', handleDragEnd);
        
        columnsContainer.appendChild(chip);
      });
    }
    
    tableSection.appendChild(columnsContainer);
    container.appendChild(tableSection);
  });
}

// Add input feature
function addInputFeature() {
  state.featureCounter++;
  const featureId = `input_${state.featureCounter}`;
  
  state.inputFeatures.push({
    id: featureId,
    mappedColumns: []
  });
  
  const container = document.getElementById('inputFeatures');
  const featureBox = document.createElement('div');
  featureBox.className = 'drop-zone border-dashed-gray bg-semi-dark bg-blur-sm p-4 rounded';
  featureBox.dataset.featureType = 'input';
  featureBox.dataset.featureId = featureId;
  
  const totalTables = state.tables.length;
  featureBox.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <div class="text-sm font-medium text-gray-300">Input Feature ${state.featureCounter}</div>
      <button class="remove-feature label-remove-btn" data-feature-id="${featureId}">×</button>
    </div>
    <div class="drop-zone-content text-gray-400 text-sm">
      Drop one column from each table (need ${totalTables} columns total, one per table)
    </div>
  `;
  
  // Add drop zone listeners
  featureBox.addEventListener('dragover', handleDragOver);
  featureBox.addEventListener('drop', handleDrop);
  featureBox.addEventListener('dragleave', handleDragLeave);
  
  // Add remove button listener
  featureBox.querySelector('.remove-feature').addEventListener('click', () => removeInputFeature(featureId));
  
  container.appendChild(featureBox);
  updateProceedButton();
}

// Bulk add all columns that appear in EVERY table as separate input features
function addAllColumnsAsFeatures() {
  if (!state.tables.length) return;
  const totalTables = state.tables.length;
  // Build sets of columns per table
  const tableColumnSets = state.tables.map(t => new Set(t.columns));
  // Intersect to get columns present in every table
  const commonColumns = state.tables[0].columns.filter(col => tableColumnSets.every(set => set.has(col)));
  if (!commonColumns.length) {
    alert('No common columns across all tables to add.');
    return;
  }
  // Filter out columns already assigned anywhere
  const alreadyAssigned = new Set();
  state.inputFeatures.forEach(f => f.mappedColumns.forEach(c => alreadyAssigned.add(c.columnName)));
  const toAdd = commonColumns.filter(c => !alreadyAssigned.has(c));
  if (!toAdd.length) {
    alert('All common columns are already assigned to features.');
    return;
  }
  let addedCount = 0;
  toAdd.forEach(columnName => {
    // Create a new feature
    state.featureCounter++;
    const featureId = `input_${state.featureCounter}`;
    const mappedColumns = state.tables.map((table, tableIndex) => ({
      tableIndex,
      columnName,
      tableName: table.tabName
    }));
    state.inputFeatures.push({ id: featureId, mappedColumns });
    // Render UI element
    const container = document.getElementById('inputFeatures');
    const featureBox = document.createElement('div');
    featureBox.className = 'drop-zone border-dashed-gray bg-semi-dark bg-blur-sm p-4 rounded filled';
    featureBox.dataset.featureType = 'input';
    featureBox.dataset.featureId = featureId;
    featureBox.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="text-sm font-medium text-gray-300">Input Feature ${state.featureCounter}</div>
        <button class="remove-feature label-remove-btn" data-feature-id="${featureId}">×</button>
      </div>
      <div class="drop-zone-content text-gray-400 text-sm"></div>
    `;
    featureBox.querySelector('.remove-feature').addEventListener('click', () => removeInputFeature(featureId));
    container.appendChild(featureBox);
    renderFeatureContent(featureId);
    addedCount++;
  });
  populateAvailableColumns();
  updateMappingSummary();
  updateProceedButton();
  autoSaveFeatureMapping();
  console.log(`✅ Added ${addedCount} features from ${toAdd.length} common column(s).`);
  alert(`Added ${addedCount} input feature(s) from common columns.`);
}

// Remove input feature
function removeInputFeature(featureId) {
  const index = state.inputFeatures.findIndex(f => f.id === featureId);
  if (index !== -1) {
    state.inputFeatures.splice(index, 1);
  }
  
  document.querySelector(`[data-feature-id="${featureId}"]`).remove();
  populateAvailableColumns(); // Refresh to show columns again
  updateProceedButton();
  autoSaveFeatureMapping(); // Auto-save changes
}

// Drag and drop handlers
let draggedColumn = null;

function handleDragStart(e) {
  draggedColumn = {
    tableIndex: parseInt(e.target.dataset.tableIndex),
    columnName: e.target.dataset.columnName,
    tableName: e.target.dataset.tableName
  };
  e.target.style.opacity = '0.5';
  e.dataTransfer.effectAllowed = 'copy';
}

function handleDragEnd(e) {
  e.target.style.opacity = '1';
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  
  if (!draggedColumn) return;
  
  const featureType = e.currentTarget.dataset.featureType;
  const featureId = e.currentTarget.dataset.featureId;
  
  if (featureType === 'input') {
    addColumnToInputFeature(featureId, draggedColumn);
  } else if (featureType === 'output') {
    setOutputFeature(draggedColumn);
  }
  
  draggedColumn = null;
  updateProceedButton();
}

// Add column to input feature (one column per table required)
function addColumnToInputFeature(featureId, columnData) {
  const feature = state.inputFeatures.find(f => f.id === featureId);
  if (!feature) return;
  
  // Check if we already have a column from this table
  const hasColumnFromTable = feature.mappedColumns.some(
    c => c.tableIndex === columnData.tableIndex
  );
  
  if (hasColumnFromTable) {
    alert(`This feature already has a column from ${columnData.tableName}. Each feature must have exactly one column from each table. Remove the existing column from this table first.`);
    return;
  }
  
  // Check if column already added
  const exists = feature.mappedColumns.some(
    c => c.tableIndex === columnData.tableIndex && c.columnName === columnData.columnName
  );
  
  if (exists) {
    alert('This column is already added to this feature');
    return;
  }
  
  feature.mappedColumns.push(columnData);
  renderFeatureContent(featureId);
  populateAvailableColumns(); // Refresh to remove assigned column
  
  // Check if feature is complete
  if (feature.mappedColumns.length === state.tables.length) {
    console.log(`✅ Feature ${featureId} is complete with columns from all ${state.tables.length} tables`);
  } else {
    console.log(`⚠️ Feature ${featureId} has ${feature.mappedColumns.length}/${state.tables.length} columns`);
  }
}

// Set output feature (needs one column from each table)
function setOutputFeature(columnData) {
  // Initialize if not exists
  if (!state.outputFeature) {
    state.outputFeature = { columns: [] };
  }
  
  // Check if we already have a column from this table
  const hasColumnFromTable = state.outputFeature.columns.some(
    c => c.tableIndex === columnData.tableIndex
  );
  
  if (hasColumnFromTable) {
    alert(`Output label already has a column from ${columnData.tableName}. Each output must have exactly one column from each table. Remove the existing column from this table first.`);
    return;
  }
  
  // Add column - clear label mapping whenever output changes
  state.outputFeature.columns.push(columnData);
  state.labelMapping = null; // Reset label mapping on any change
  
  renderOutputFeature();
  populateAvailableColumns(); // Refresh to remove assigned column
  
  // Check if complete - automatically analyze labels
  if (state.outputFeature.columns.length === state.tables.length) {
    console.log(`✅ Output label is complete with columns from all ${state.tables.length} tables`);
    console.log('🔄 Automatically analyzing labels...');
    // Automatically analyze unique values and create label mapping
    analyzeOutputLabels().then(() => {
      renderLabelMapping();
      autoSaveFeatureMapping(); // Auto-save after creating label mapping
    });
  } else {
    console.log(`⚠️ Output label has ${state.outputFeature.columns.length}/${state.tables.length} columns - waiting for completion`);
    renderLabelMapping(); // This will hide the section since labelMapping is null
    autoSaveFeatureMapping(); // Auto-save changes
  }
}

// Analyze unique values in output columns
async function analyzeOutputLabels() {
  if (!state.outputFeature || !state.outputFeature.columns || state.outputFeature.columns.length === 0) {
    console.log('⚠️ No output feature columns defined');
    return;
  }
  
  try {
    console.log('🔍 Starting label analysis...');
    console.log('Output columns:', state.outputFeature.columns);
    
    // Load data from all tables
    const selection = await dataStore.getTrainingSelection();
    const sortedTables = selection.tables.sort((a, b) => a.tabOrder - b.tabOrder);
    
    console.log('Tables in order:', sortedTables.map(t => t.tabName));
    
    const tableDataArrays = await Promise.all(
      sortedTables.map(async (table) => {
        const records = await dataStore.getRecordsByIds(table.selectedIds, table.datasetId);
        console.log(`Loaded ${records.length} records from ${table.tabName}`);
        return records;
      })
    );
    
    // Collect unique values from ALL output columns (individual values, not combined)
    const uniqueValuesSet = new Set();
    
    // Align and extract output values
    const minRows = Math.min(...tableDataArrays.map(t => t.length));
    console.log(`Processing ${minRows} aligned rows...`);
    
    // Sort output columns by tableIndex to maintain consistent order
    const sortedOutputCols = [...state.outputFeature.columns].sort((a, b) => a.tableIndex - b.tableIndex);
    
    for (let i = 0; i < minRows; i++) {
      sortedOutputCols.forEach(col => {
        const tableData = tableDataArrays[col.tableIndex][i];
        const value = tableData[col.columnName];
        
        if (i < 5) { // Log first 5 for debugging
          console.log(`Row ${i}, Table ${col.tableIndex} (${col.tableName}), Column ${col.columnName}:`, value, typeof value);
        }
        
        // Convert value to string, preserve actual values including numbers and strings
        const cleanValue = (value === null || value === undefined || value === '') ? '<empty>' : String(value).trim();
        
        // Add each value separately (not combined)
        if (cleanValue !== '<empty>') {
          uniqueValuesSet.add(cleanValue);
        }
      });
    }
    
    const uniqueValues = Array.from(uniqueValuesSet).sort();
    console.log(`✅ Found ${uniqueValues.length} unique output values:`, uniqueValues);
    
    if (uniqueValues.length === 0) {
      console.error('❌ No unique values found!');
      console.error('This could mean:');
      console.error('1. All values in the output column(s) are empty/null');
      console.error('2. The column name does not exist in the data');
      console.error('3. Data alignment issue between tables');
      
      // Show sample data for debugging
      console.error('Sample record from first table:', tableDataArrays[0][0]);
      
      alert('Error: No unique values found in output columns.\n\nThis could mean:\n- All values are empty/null\n- Column name does not exist in data\n- Data alignment issue\n\nCheck the browser console for details.');
      return;
    }
    
    // Create default target labels (one per unique value)
    const targetLabels = uniqueValues.map((value, index) => ({
      id: `label_${++state.labelCounter}`,
      name: `Label ${index}`,
      mappedValues: [value] // Default: one-to-one mapping
    }));
    
    state.labelMapping = {
      uniqueValues,
      targetLabels
    };
    
    console.log('Label mapping created:', state.labelMapping);
    
    renderLabelMapping();
    autoSaveFeatureMapping(); // Auto-save after creating label mapping
  } catch (error) {
    console.error('❌ Error analyzing output labels:', error);
    console.error('Stack trace:', error.stack);
    alert(`Error analyzing labels: ${error.message}`);
  }
}

// Render input feature content
function renderFeatureContent(featureId) {
  const feature = state.inputFeatures.find(f => f.id === featureId);
  if (!feature) return;
  
  const featureBox = document.querySelector(`[data-feature-id="${featureId}"]`);
  const contentDiv = featureBox.querySelector('.drop-zone-content');
  const totalTables = state.tables.length;
  
  if (feature.mappedColumns.length === 0) {
    contentDiv.innerHTML = `<span class="drop-zone-empty">Drop one column from each table (0/${totalTables})</span>`;
    featureBox.classList.remove('filled');
  } else {
    // Sort by table order
    const sortedColumns = feature.mappedColumns.sort((a, b) => a.tableIndex - b.tableIndex);
    
    // Check if complete
    const isComplete = feature.mappedColumns.length === totalTables;
    
    let html = '';
    // Only show warning if incomplete
    if (!isComplete) {
      html = `<div class="bg-yellow-50 text-yellow-700 text-xs px-2 py-1 rounded mb-2 inline-block">⚠ ${feature.mappedColumns.length}/${totalTables} columns</div><br>`;
    }
    html += sortedColumns.map(col => `
      <div class="value-chip">
        <span class="font-medium">${col.tableName}:</span>
        <span class="ml-1">${col.columnName}</span>
        <button class="remove-value-btn" 
                onclick="removeColumnFromFeature('${featureId}', ${col.tableIndex}, '${col.columnName}')">×</button>
      </div>
    `).join('');
    
    contentDiv.innerHTML = html;
    featureBox.classList.add('filled');
  }
  
  updateMappingSummary();
  autoSaveFeatureMapping();
}

// Render output feature
function renderOutputFeature() {
  const featureBox = document.querySelector('[data-feature-type="output"]');
  const contentDiv = featureBox.querySelector('.drop-zone-content');
  const totalTables = state.tables.length;
  
  if (!state.outputFeature || !state.outputFeature.columns || state.outputFeature.columns.length === 0) {
    contentDiv.innerHTML = `<span class="drop-zone-empty">Drop one column from each table (0/${totalTables})</span>`;
    featureBox.classList.remove('filled');
  } else {
    // Sort by table order
    const sortedColumns = state.outputFeature.columns.sort((a, b) => a.tableIndex - b.tableIndex);
    
    // Check if complete
    const isComplete = state.outputFeature.columns.length === totalTables;
    
    let html = '';
    // Only show warning if incomplete
    if (!isComplete) {
      html = `<div class="bg-yellow-50 text-yellow-700 text-xs px-2 py-1 rounded mb-2 inline-block">⚠ ${state.outputFeature.columns.length}/${totalTables} columns</div><br>`;
    }
    html += sortedColumns.map(col => `
      <div class="value-chip">
        <span class="font-medium">${col.tableName}:</span>
        <span class="ml-1">${col.columnName}</span>
        <button class="remove-value-btn" 
                onclick="removeOutputColumn(${col.tableIndex}, '${col.columnName}')">×</button>
      </div>
    `).join('');
    
    contentDiv.innerHTML = html;
    featureBox.classList.add('filled');
    
    // If output feature is complete and no label mapping exists yet, analyze labels
    if (isComplete && !state.labelMapping) {
      analyzeOutputLabels();
    }
  }
  
  updateMappingSummary();
  autoSaveFeatureMapping();
}

// Remove column from feature
window.removeColumnFromFeature = function(featureId, tableIndex, columnName) {
  const feature = state.inputFeatures.find(f => f.id === featureId);
  if (!feature) return;
  
  feature.mappedColumns = feature.mappedColumns.filter(
    c => !(c.tableIndex === tableIndex && c.columnName === columnName)
  );
  
  renderFeatureContent(featureId);
  populateAvailableColumns(); // Refresh to show the column again
  updateProceedButton();
};

// Remove column from output feature
window.removeOutputColumn = function(tableIndex, columnName) {
  if (!state.outputFeature || !state.outputFeature.columns) return;
  
  state.outputFeature.columns = state.outputFeature.columns.filter(
    c => !(c.tableIndex === tableIndex && c.columnName === columnName)
  );
  
  // Reset label mapping whenever output changes
  state.labelMapping = null;
  
  renderOutputFeature();
  populateAvailableColumns(); // Refresh to show the column again
  updateProceedButton();
  
  // Check if output feature is still complete - automatically re-analyze
  if (state.outputFeature.columns.length === state.tables.length) {
    console.log('🔄 Output still complete after removal, automatically re-analyzing labels...');
    analyzeOutputLabels().then(() => {
      renderLabelMapping();
      autoSaveFeatureMapping();
    });
  } else {
    console.log('⚠️ Output incomplete after removal - waiting for completion');
    renderLabelMapping(); // This will hide the section
    autoSaveFeatureMapping();
  }
};

// Remove all output features
window.removeOutputFeature = function() {
  state.outputFeature = { columns: [] };
  // Clear label mapping when output feature is removed
  state.labelMapping = null;
  renderOutputFeature();
  renderLabelMapping();
  updateProceedButton();
  autoSaveFeatureMapping(); // Save cleared state to storage
};

// Update mapping summary
function updateMappingSummary() {
  const summaryDiv = document.getElementById('mappingSummary');
  const contentDiv = document.getElementById('summaryContent');
  
  if (state.inputFeatures.length === 0 && !state.outputFeature) {
    summaryDiv.classList.add('hidden');
    return;
  }
  
  let html = '<div class="space-y-2">';
  
  // Input features
  state.inputFeatures.forEach((feature, index) => {
    if (feature.mappedColumns.length > 0) {
      const sortedCols = feature.mappedColumns.sort((a, b) => a.tableIndex - b.tableIndex);
      const colsList = sortedCols.map(c => `${c.tableName}.${c.columnName}`).join(' + ');
      html += `<div><strong>Input ${index + 1}:</strong> ${colsList}</div>`;
    }
  });
  
  // Output
  if (state.outputFeature && state.outputFeature.columns && state.outputFeature.columns.length > 0) {
    const sortedCols = state.outputFeature.columns.sort((a, b) => a.tableIndex - b.tableIndex);
    const colsList = sortedCols.map(c => `${c.tableName}.${c.columnName}`).join(' + ');
    html += `<div><strong>Output:</strong> ${colsList}</div>`;
    
    // Label mapping summary
    if (state.labelMapping && state.labelMapping.targetLabels.length > 0) {
      const unmappedCount = state.labelMapping.uniqueValues.length - 
        state.labelMapping.targetLabels.reduce((sum, label) => sum + label.mappedValues.length, 0);
      html += `<div class="text-sm"><strong>Labels:</strong> ${state.labelMapping.targetLabels.length} target labels, `;
      html += `${state.labelMapping.uniqueValues.length} unique values`;
      if (unmappedCount > 0) {
        html += ` <span class="text-yellow-600">(${unmappedCount} unmapped)</span>`;
      } else {
        html += ` <span class="text-green-600">✓</span>`;
      }
      html += `</div>`;
    }
  }
  
  html += '</div>';
  contentDiv.innerHTML = html;
  summaryDiv.classList.remove('hidden');
}

// Update proceed button state
function updateProceedButton() {
  const totalTables = state.tables.length;
  const hasCompleteInput = state.inputFeatures.some(f => f.mappedColumns.length === totalTables);
  const hasCompleteOutput = state.outputFeature && state.outputFeature.columns && 
                            state.outputFeature.columns.length === totalTables;
  
  document.getElementById('proceedToTraining').disabled = !(hasCompleteInput && hasCompleteOutput);
}

// Auto-save feature mapping to database
async function autoSaveFeatureMapping() {
  try {
    // Prepare feature mapping configuration
    const validInputs = state.inputFeatures.filter(f => f.mappedColumns.length > 0);
    
    const featureMapping = {
      inputFeatures: validInputs.map(f => ({
        columns: f.mappedColumns.sort((a, b) => a.tableIndex - b.tableIndex)
      })),
      outputFeature: state.outputFeature || { columns: [] },
      labelMapping: state.labelMapping ? {
        uniqueValues: Array.isArray(state.labelMapping.uniqueValues) 
          ? state.labelMapping.uniqueValues 
          : Array.from(state.labelMapping.uniqueValues || []),
        targetLabels: state.labelMapping.targetLabels.map((label, index) => ({
          id: label.id,
          name: label.name,
          index: index,
          mappedValues: Array.isArray(label.mappedValues) ? label.mappedValues : []
        }))
      } : null,
      tableOrder: state.tables.map(t => t.tabName)
    };
    
    await dataStore.saveFeatureMapping(featureMapping);
    console.log('💾 Auto-saved feature mapping');
  } catch (error) {
    console.error('Error auto-saving feature mapping:', error);
  }
}

// Reset mapping
async function resetMapping() {
  if (!confirm('Reset all feature mappings and label assignments?')) return;
  
  state.inputFeatures = [];
  state.outputFeature = { columns: [] };
  state.featureCounter = 0;
  state.labelMapping = null;
  state.labelCounter = 0;
  
  document.getElementById('inputFeatures').innerHTML = '';
  renderOutputFeature();
  
  // Hide label mapping section
  const labelSection = document.getElementById('labelMappingSection');
  if (labelSection) {
    labelSection.classList.add('hidden');
  }
  
  updateMappingSummary();
  updateProceedButton();
  
  // Clear the saved mapping from database
  try {
    // Save empty mapping to clear it
    await dataStore.saveFeatureMapping({
      inputFeatures: [],
      outputFeature: { columns: [] },
      labelMapping: null,
      tableOrder: state.tables.map(t => t.tabName)
    });
    console.log('✅ Feature mapping cleared from database');
  } catch (error) {
    console.error('Error clearing feature mapping:', error);
  }
}

// Proceed to training
async function proceedToTraining() {
  const totalTables = state.tables.length;
  
  // Validate that each feature has columns from all tables
  const incompleteFeatures = state.inputFeatures.filter(
    f => f.mappedColumns.length > 0 && f.mappedColumns.length < totalTables
  );
  
  if (incompleteFeatures.length > 0) {
    alert(`Some features are incomplete! Each feature must have exactly one column from each of the ${totalTables} tables. Please complete all features or remove incomplete ones.`);
    return;
  }
  
  // Validate mapping
  const validInputs = state.inputFeatures.filter(f => f.mappedColumns.length === totalTables);
  
  const hasCompleteOutput = state.outputFeature && state.outputFeature.columns && 
                            state.outputFeature.columns.length === totalTables;
  
  if (validInputs.length === 0 || !hasCompleteOutput) {
    alert('Please map at least one complete input feature and one complete output label (both with columns from all tables)');
    return;
  }
  
  // Validate label mapping (all values must be mapped)
  if (state.labelMapping) {
    const mappedCount = state.labelMapping.targetLabels.reduce(
      (sum, label) => sum + label.mappedValues.length, 0
    );
    const unmappedCount = state.labelMapping.uniqueValues.length - mappedCount;
    // Allow unmapped labels: we'll skip those rows during training.
    if (state.labelMapping.targetLabels.length === 0) {
      alert('Please create at least one target label.');
      return;
    }
    if (unmappedCount > 0) {
      const proceed = confirm(`There are ${unmappedCount} unmapped value(s).\n\nUnmapped labels will be excluded from training (their rows dropped).\n\nContinue?`);
      if (!proceed) return;
    }
  }
  
  // Prepare feature mapping configuration
  const featureMapping = {
    inputFeatures: validInputs.map(f => ({
      columns: f.mappedColumns.sort((a, b) => a.tableIndex - b.tableIndex) // Ensure table order
    })),
    outputFeature: {
      columns: state.outputFeature.columns.sort((a, b) => a.tableIndex - b.tableIndex) // Ensure table order
    },
    labelMapping: state.labelMapping ? {
      uniqueValues: Array.from(state.labelMapping.uniqueValues),
      targetLabels: state.labelMapping.targetLabels.map((label, index) => ({
        id: label.id,
        name: label.name,
        index: index, // Numerical encoding (0, 1, 2, ...)
        mappedValues: label.mappedValues
      }))
    } : null,
    tableOrder: state.tables.map(t => t.tabName)
  };
  
  try {
    // Save feature mapping to IndexedDB
    await dataStore.saveFeatureMapping(featureMapping);
    
    console.log('Feature mapping saved:', featureMapping);
    console.log('Table order:', featureMapping.tableOrder);
    
    // Navigate to training page
    window.location.href = 'training.html';
  } catch (e) {
    alert('Error saving feature mapping: ' + e.message);
    console.error('Error:', e);
  }
}

// Render label mapping interface
function renderLabelMapping() {
  const section = document.getElementById('labelMappingSection');
  if (!section) {
    console.error('Label mapping section not found in DOM');
    return;
  }
  
  // Hide section if no label mapping
  if (!state.labelMapping) {
    section.classList.add('hidden');
    return;
  }
  
  section.classList.remove('hidden');
  
  // Small delay to ensure DOM is ready
  setTimeout(() => {
    // Render available values
    renderAvailableValues();
    
    // Render target labels
    renderTargetLabels();
  }, 10);
}

// Render available values (unmapped values)
function renderAvailableValues() {
  const container = document.getElementById('availableValues');
  if (!container) {
    console.error('availableValues container not found');
    return;
  }
  
  if (!state.labelMapping) {
    console.error('No label mapping in state');
    return;
  }
  
  container.innerHTML = '';
  
  // Get mapped values
  const mappedValues = new Set();
  state.labelMapping.targetLabels.forEach(label => {
    label.mappedValues.forEach(v => mappedValues.add(v));
  });
  
  // Show unmapped values
  const unmappedValues = state.labelMapping.uniqueValues.filter(v => !mappedValues.has(v));
  
  if (unmappedValues.length === 0) {
    container.innerHTML = '<p class="helper-text">All values are mapped</p>';
    return;
  }
  
  unmappedValues.forEach(value => {
    const chip = document.createElement('div');
    chip.className = 'draggable bg-semi-light bg-blur px-3 py-2 text-gray-300 text-sm rounded border border-gray-700 hover:bg-gray-600';
    chip.textContent = value;
    chip.draggable = true;
    chip.dataset.value = value;
    
    chip.addEventListener('dragstart', (e) => {
      e.target.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', value);
    });
    
    chip.addEventListener('dragend', (e) => {
      e.target.style.opacity = '1';
    });
    
    container.appendChild(chip);
  });
}

// Render target labels
function renderTargetLabels() {
  const container = document.getElementById('targetLabels');
  if (!container) {
    console.error('targetLabels container not found');
    return;
  }
  
  if (!state.labelMapping) {
    console.error('No label mapping in state');
    return;
  }
  
  container.innerHTML = '';
  
  state.labelMapping.targetLabels.forEach(label => {
    const labelBox = document.createElement('div');
    labelBox.className = 'label-box';
    labelBox.dataset.labelId = label.id;
    
    // Label header
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-2';
    
    // Container for input with icon
    const nameContainer = document.createElement('div');
    nameContainer.className = 'label-name-container';
    
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = label.name;
    nameInput.className = 'label-name-input';
    nameInput.placeholder = 'Enter label name...';
    nameInput.addEventListener('change', (e) => {
      label.name = e.target.value;
      updateMappingSummary();
      autoSaveFeatureMapping(); // Auto-save changes
    });
    
    const editIcon = document.createElement('span');
    editIcon.className = 'label-edit-icon';
    editIcon.innerHTML = '✏️';
    
    nameContainer.appendChild(nameInput);
    nameContainer.appendChild(editIcon);
    
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.className = 'label-remove-btn';
    removeBtn.addEventListener('click', () => removeTargetLabel(label.id));
    
    header.appendChild(nameContainer);
    header.appendChild(removeBtn);
    labelBox.appendChild(header);
    
    // Mapped values
    const valuesContainer = document.createElement('div');
    valuesContainer.className = 'min-h-[40px] space-y-1';
    valuesContainer.dataset.labelId = label.id;
    
    if (label.mappedValues.length === 0) {
      valuesContainer.innerHTML = '<p class="helper-text-sm">Drop values here</p>';
      labelBox.classList.remove('filled');
    } else {
      labelBox.classList.add('filled');
      
      label.mappedValues.forEach(value => {
        const valueChip = document.createElement('div');
        valueChip.className = 'value-chip';
        valueChip.draggable = true;
        valueChip.dataset.value = value;
        valueChip.dataset.sourceLabelId = label.id;
        
        // Make value chip draggable
        valueChip.addEventListener('dragstart', (e) => {
          e.target.style.opacity = '0.5';
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', value);
          e.dataTransfer.setData('sourceLabelId', label.id);
        });
        
        valueChip.addEventListener('dragend', (e) => {
          e.target.style.opacity = '1';
        });
        
        const valueText = document.createElement('span');
        valueText.textContent = value;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-value-btn';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.removeValueFromLabel(label.id, value);
        });
        
        valueChip.appendChild(valueText);
        valueChip.appendChild(removeBtn);
        valuesContainer.appendChild(valueChip);
      });
    }
    
    // Make drop zone
    valuesContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      labelBox.classList.add('drag-over');
    });
    
    valuesContainer.addEventListener('dragleave', () => {
      labelBox.classList.remove('drag-over');
    });
    
    valuesContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      labelBox.classList.remove('drag-over');
      
      const value = e.dataTransfer.getData('text/plain');
      const sourceLabelId = e.dataTransfer.getData('sourceLabelId');
      
      // If dragging from another label, remove it from source first
      if (sourceLabelId && sourceLabelId !== label.id) {
        removeValueFromLabelSilent(sourceLabelId, value);
      }
      
      addValueToLabel(label.id, value);
      
      // Auto-remove empty labels (except if it's the last one)
      if (state.labelMapping.targetLabels.length > 1) {
        autoRemoveEmptyLabels();
      }
    });
    
    labelBox.appendChild(valuesContainer);
    container.appendChild(labelBox);
  });
}

// Add value to target label
function addValueToLabel(labelId, value) {
  const label = state.labelMapping.targetLabels.find(l => l.id === labelId);
  if (!label) return;
  
  if (!label.mappedValues.includes(value)) {
    label.mappedValues.push(value);
    renderAvailableValues();
    renderTargetLabels();
    updateMappingSummary();
    autoSaveFeatureMapping(); // Auto-save changes
  }
}

// Remove value from label
window.removeValueFromLabel = function(labelId, value) {
  const label = state.labelMapping.targetLabels.find(l => l.id === labelId);
  if (!label) return;
  
  label.mappedValues = label.mappedValues.filter(v => v !== value);
  renderAvailableValues();
  renderTargetLabels();
  updateMappingSummary();
  autoSaveFeatureMapping();
  
  // Auto-remove empty labels (except if it's the last one)
  if (state.labelMapping.targetLabels.length > 1) {
    autoRemoveEmptyLabels();
  }
};

// Remove value from label without re-rendering (used internally)
function removeValueFromLabelSilent(labelId, value) {
  const label = state.labelMapping.targetLabels.find(l => l.id === labelId);
  if (!label) return;
  
  label.mappedValues = label.mappedValues.filter(v => v !== value);
}

// Auto-remove empty labels
function autoRemoveEmptyLabels() {
  if (!state.labelMapping) return;
  
  // Keep at least one label
  if (state.labelMapping.targetLabels.length <= 1) return;
  
  const nonEmptyLabels = state.labelMapping.targetLabels.filter(l => l.mappedValues.length > 0);
  
  // Only update if we're removing something and keeping at least one label
  if (nonEmptyLabels.length > 0 && nonEmptyLabels.length < state.labelMapping.targetLabels.length) {
    state.labelMapping.targetLabels = nonEmptyLabels;
    renderTargetLabels();
    updateMappingSummary();
    autoSaveFeatureMapping();
  }
}

// Add new target label
function addTargetLabel() {
  if (!state.labelMapping) return;
  
  state.labelMapping.targetLabels.push({
    id: `label_${++state.labelCounter}`,
    name: `Label ${state.labelMapping.targetLabels.length}`,
    mappedValues: []
  });
  
  renderTargetLabels();
  autoSaveFeatureMapping(); // Auto-save changes
}

// Remove target label
function removeTargetLabel(labelId) {
  if (!state.labelMapping) return;
  
  const index = state.labelMapping.targetLabels.findIndex(l => l.id === labelId);
  if (index !== -1) {
    state.labelMapping.targetLabels.splice(index, 1);
    renderAvailableValues();
    renderTargetLabels();
    updateMappingSummary();
    autoSaveFeatureMapping(); // Auto-save changes
  }
}

// Event listeners
document.getElementById('addFeatureBtn').addEventListener('click', addInputFeature);
const addAllBtn = document.getElementById('addAllFeaturesBtn');
if (addAllBtn) {
  addAllBtn.addEventListener('click', addAllColumnsAsFeatures);
}
document.getElementById('resetMapping').addEventListener('click', resetMapping);
document.getElementById('proceedToTraining').addEventListener('click', proceedToTraining);

// Add label mapping button listener
document.addEventListener('DOMContentLoaded', () => {
  const addLabelBtn = document.getElementById('addLabelBtn');
  if (addLabelBtn) {
    addLabelBtn.addEventListener('click', addTargetLabel);
  }
});

// Add drop zone listeners to output feature
const outputZone = document.querySelector('[data-feature-type="output"]');
outputZone.addEventListener('dragover', handleDragOver);
outputZone.addEventListener('drop', handleDrop);
outputZone.addEventListener('dragleave', handleDragLeave);

// Load saved feature mapping
async function loadSavedMapping() {
  try {
    const mappingData = await dataStore.getFeatureMapping();
    if (mappingData && mappingData.mapping) {
      const savedMapping = mappingData.mapping;
      console.log('📥 Loading saved feature mapping:', savedMapping);
      
      // Restore input features
      if (savedMapping.inputFeatures && savedMapping.inputFeatures.length > 0) {
        savedMapping.inputFeatures.forEach((feature, index) => {
          const featureId = `input_${++state.featureCounter}`;
          
          state.inputFeatures.push({
            id: featureId,
            mappedColumns: feature.columns || []
          });
          
          const container = document.getElementById('inputFeatures');
          const featureBox = document.createElement('div');
          featureBox.className = 'drop-zone border-dashed-gray bg-semi-dark bg-blur-sm p-4 rounded';
          featureBox.dataset.featureType = 'input';
          featureBox.dataset.featureId = featureId;
          
          const totalTables = state.tables.length;
          featureBox.innerHTML = `
            <div class="flex items-center justify-between mb-2">
              <div class="text-sm font-medium text-gray-300">Input Feature ${state.featureCounter}</div>
              <button class="remove-feature label-remove-btn" data-feature-id="${featureId}">×</button>
            </div>
            <div class="drop-zone-content text-gray-400 text-sm">
              Drop one column from each table (need ${totalTables} columns total, one per table)
            </div>
          `;
          
          featureBox.addEventListener('dragover', handleDragOver);
          featureBox.addEventListener('drop', handleDrop);
          featureBox.addEventListener('dragleave', handleDragLeave);
          featureBox.querySelector('.remove-feature').addEventListener('click', () => removeInputFeature(featureId));
          
          container.appendChild(featureBox);
          renderFeatureContent(featureId);
        });
      }
      
      // Restore label mapping FIRST (before rendering output feature)
      if (savedMapping.labelMapping) {
        state.labelMapping = {
          uniqueValues: savedMapping.labelMapping.uniqueValues || [],
          targetLabels: savedMapping.labelMapping.targetLabels.map(label => ({
            id: label.id,
            name: label.name,
            mappedValues: label.mappedValues || []
          }))
        };
        
        // Update label counter to avoid ID conflicts
        state.labelCounter = Math.max(
          ...state.labelMapping.targetLabels.map(l => {
            const match = l.id.match(/label_(\d+)/);
            return match ? parseInt(match[1]) : 0;
          }),
          0
        );
      }
      
      // Restore output feature (after label mapping is set)
      if (savedMapping.outputFeature && savedMapping.outputFeature.columns) {
        state.outputFeature = {
          columns: savedMapping.outputFeature.columns || []
        };
        renderOutputFeature();
      }
      
      // Render label mapping UI if it exists
      if (state.labelMapping) {
        renderLabelMapping();
      }
      
      // Refresh available columns to hide assigned ones
      populateAvailableColumns();
      
      updateMappingSummary();
      updateProceedButton();
      
      console.log('✅ Feature mapping restored successfully');
      return true;
    }
  } catch (error) {
    console.log('No saved mapping found or error loading:', error.message);
  }
  return false;
}

// Reload mapping when window regains focus (after visiting other pages)
window.addEventListener('focus', async () => {
  console.log('🔄 Window focused, reloading feature mapping...');
  
  // Clear current state
  state.inputFeatures = [];
  state.outputFeature = { columns: [] };
  state.featureCounter = 0;
  state.labelMapping = null;
  state.labelCounter = 0;
  
  // Clear UI
  document.getElementById('inputFeatures').innerHTML = '';
  const labelSection = document.getElementById('labelMappingSection');
  if (labelSection) {
    labelSection.classList.add('hidden');
  }
  
  // Reload data and mapping
  const loaded = await loadTrainingData();
  if (loaded) {
    const mappingLoaded = await loadSavedMapping();
    if (!mappingLoaded) {
      addInputFeature();
    }
  }
  
  updateMappingSummary();
  updateProceedButton();
});

// Initialize
(async () => {
  const loaded = await loadTrainingData();
  if (loaded) {
    // Try to load saved mapping first
    const mappingLoaded = await loadSavedMapping();
    
    // If no saved mapping, add one input feature by default
    if (!mappingLoaded) {
      addInputFeature();
    }
  }
})();
