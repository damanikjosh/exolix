import dataStore from './dataStore.js';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as tfvis from '@tensorflow/tfjs-vis';

// Training page logic
let trainingData = [];
let featureMapping = null;
let extractedFeatures = null;
let model = null;

// Load training data from IndexedDB (multi-table approach)
async function loadTrainingData() {
  try {
    // Get feature mapping
    const mappingData = await dataStore.getFeatureMapping();
    if (!mappingData || !mappingData.mapping) {
      console.log('No feature mapping found');
      return { success: false, error: 'No feature mapping' };
    }
    featureMapping = mappingData.mapping;
    
    // Get training selection
    const selection = await dataStore.getTrainingSelection();
    if (!selection || !selection.tables || selection.tables.length === 0) {
      console.log('No training selection found');
      return { success: false, error: 'No training selection' };
    }
    
    console.log('Loading training data from', selection.tables.length, 'tables');
    console.log('Feature mapping:', featureMapping);
    
    // Sort tables by tab order (critical!)
    const sortedTables = selection.tables.sort((a, b) => a.tabOrder - b.tabOrder);
    
    // Load data from each table
    const tableDataArrays = await Promise.all(
      sortedTables.map(async (table) => {
        const records = await dataStore.getRecordsByIds(
          table.selectedIds,
          table.datasetId
        );
        console.log(`Loaded ${records.length} records from ${table.tabName}`);
        return records;
      })
    );
    
    // Concatenate data from all tables
    const concatenatedData = concatenateTableData(tableDataArrays);
    console.log('Concatenated data:', concatenatedData.length, 'rows');
    
    // Extract features based on mapping
    extractedFeatures = extractFeatures(concatenatedData, featureMapping, sortedTables);
    console.log('Extracted features:', extractedFeatures);
    
    trainingData = extractedFeatures;
    
    // Check storage estimate
    const estimate = await dataStore.getStorageEstimate();
    if (estimate) {
      console.log('Storage used:', (estimate.usage / 1024 / 1024).toFixed(2), 'MB');
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error loading training data:', error);
    return { success: false, error: error.message };
  }
}

// Concatenate data from all tables (each table contributes its own rows)
function concatenateTableData(tableDataArrays) {
  if (tableDataArrays.length === 0) return [];
  
  console.log('Concatenating data from', tableDataArrays.length, 'tables');
  
  // Each table contributes all its rows
  // Each "row" in the result is actually one record from one table
  // The record needs to know which table it came from for column mapping
  const allRows = [];
  
  tableDataArrays.forEach((tableData, tableIndex) => {
    console.log(`Table ${tableIndex}: contributing ${tableData.length} rows`);
    
    tableData.forEach(record => {
      // Create a row entry that contains this record with table metadata
      allRows.push({
        tableIndex: tableIndex,
        record: record
      });
    });
  });
  
  console.log('Total concatenated rows:', allRows.length);
  return allRows;
}

// Extract features based on mapping (extracts from each row in concatenated data)
function extractFeatures(concatenatedData, mapping, sortedTables) {
  const inputFeatures = [];
  const outputLabels = [];
  const outputRawValues = []; // Store raw values for display
  const tableIndices = []; // Track which table each row came from
  const tableNames = []; // Track table names for each row
  
  // Build label encoder from mapping
  let labelEncoder = null;
  if (mapping.labelMapping && mapping.labelMapping.targetLabels) {
    labelEncoder = buildLabelEncoder(mapping.labelMapping);
    console.log('Label encoder created:', labelEncoder);
    console.log('Label encoder has', labelEncoder.numClasses, 'classes');
    console.log('All mapped values:', Array.from(labelEncoder.valueToIndex.keys()));
  } else {
    console.warn('⚠️ No label mapping found in feature mapping');
  }
  
  concatenatedData.forEach(rowData => {
    const record = rowData.record;
    const sourceTableIndex = rowData.tableIndex;
    
    // Extract input features - only extract values from columns that belong to this record's table
    const inputRow = [];
    mapping.inputFeatures.forEach(feature => {
      // Each feature may have columns from multiple tables
      // We only extract the value from the column that belongs to this record's source table
      const columnForThisTable = feature.columns.find(col => col.tableIndex === sourceTableIndex);
      
      if (columnForThisTable) {
        const value = record[columnForThisTable.columnName];
        inputRow.push(value !== undefined && value !== null ? value : 0);
      }
      // Note: If this feature doesn't have a column from this table, we don't add anything
      // This means different tables may produce different input dimensions if they have different column assignments
    });
    inputFeatures.push(inputRow);
    
    // Store table metadata
    tableIndices.push(sourceTableIndex);
    tableNames.push(sortedTables[sourceTableIndex].tabName);
    
    // Extract output label - use the output column from this record's source table
    const outputColumnForThisTable = mapping.outputFeature.columns.find(
      col => col.tableIndex === sourceTableIndex
    );
    
    let outputValue = null;
    if (outputColumnForThisTable) {
      outputValue = record[outputColumnForThisTable.columnName];
    }
    
    // Store output value for display purposes
    const outputKey = outputValue !== null && outputValue !== undefined ? outputValue : 'unknown';
    outputRawValues.push(outputKey);
    
    // Encode label using label mapping if available
    if (labelEncoder) {
      // Try to find encoding for the output value
      let encodedLabel = null;
      
      if (outputValue !== null && outputValue !== undefined) {
        encodedLabel = labelEncoder.encode(outputValue);
      }
      
      if (encodedLabel === null) {
        // Log first few unmapped values for debugging
        if (outputLabels.filter(l => l === -1).length < 3) {
          console.warn(`⚠️ Output value "${outputKey}" from table ${sourceTableIndex} not found in label mapping`);
          console.warn('Available values in label mapping:', Array.from(labelEncoder.valueToIndex.keys()).slice(0, 10));
        }
        outputLabels.push(-1); // Use -1 for unmapped values
      } else {
        outputLabels.push(encodedLabel);
      }
    } else {
      // Fallback: use raw output values
      outputLabels.push(outputValue);
    }
  });
  
  return {
    inputs: inputFeatures,
    outputs: outputLabels,
    outputRaw: outputRawValues,
    tableIndices: tableIndices,
    tableNames: tableNames,
    inputDimension: inputFeatures[0] ? inputFeatures[0].length : 0,
    outputDimension: labelEncoder ? labelEncoder.numClasses : 1,
    sampleCount: inputFeatures.length,
    labelEncoder: labelEncoder
  };
}

// Build label encoder from label mapping
function buildLabelEncoder(labelMapping) {
  const valueToIndex = new Map();
  const indexToLabel = new Map();
  
  labelMapping.targetLabels.forEach((label, index) => {
    // Map each value to its target label index
    label.mappedValues.forEach(value => {
      valueToIndex.set(value, index);
    });
    
    // Map index to label name
    indexToLabel.set(index, label.name);
  });
  
  return {
    numClasses: labelMapping.targetLabels.length,
    valueToIndex: valueToIndex,
    indexToLabel: indexToLabel,
    encode: (value) => {
      return valueToIndex.has(value) ? valueToIndex.get(value) : null;
    },
    decode: (index) => {
      return indexToLabel.has(index) ? indexToLabel.get(index) : null;
    },
    getAllLabels: () => {
      return Array.from(indexToLabel.values());
    }
  };
}

// Display data info
function displayDataInfo(loadResult) {
  const dataInfoEl = document.getElementById('dataInfo');
  
  if (!loadResult || !loadResult.success) {
    dataInfoEl.innerHTML = `
      <p class="text-orange-600">No training data available.</p>
      <p class="text-gray-600 mt-2">
        Please complete these steps:<br>
        1. Go to <a href="multiTableExplorer.html" class="text-indigo-600 hover:underline">Data Explorer</a> and select rows<br>
        2. Click "Send to Training"<br>
        3. Define features in <a href="featureMapping.html" class="text-indigo-600 hover:underline">Feature Mapping</a><br>
        4. Return here to train
      </p>
      ${loadResult && loadResult.error ? `<p class="text-red-600 mt-2 text-sm">Error: ${loadResult.error}</p>` : ''}
    `;
    document.getElementById('startTraining').disabled = true;
    document.getElementById('downloadData').disabled = true;
    return;
  }
  
  if (!extractedFeatures || extractedFeatures.sampleCount === 0) {
    dataInfoEl.innerHTML = `
      <p class="text-orange-600">No features extracted.</p>
    `;
    document.getElementById('startTraining').disabled = true;
    document.getElementById('downloadData').disabled = true;
    return;
  }
  
  // Count output labels distribution
  const labelCounts = {};
  
  if (extractedFeatures.labelEncoder) {
    // Use encoded labels with label names
    extractedFeatures.outputs.forEach((encodedLabel, idx) => {
      const labelName = extractedFeatures.labelEncoder.decode(encodedLabel);
      const rawValue = extractedFeatures.outputRaw[idx];
      const displayKey = `${labelName} (${encodedLabel})`;
      labelCounts[displayKey] = labelCounts[displayKey] || { count: 0, samples: [] };
      labelCounts[displayKey].count++;
      if (labelCounts[displayKey].samples.length < 3) {
        labelCounts[displayKey].samples.push(rawValue);
      }
    });
  } else {
    // Fallback: use raw values
    extractedFeatures.outputs.forEach(labelArray => {
      const labelKey = Array.isArray(labelArray) ? labelArray.join('|') : labelArray;
      labelCounts[labelKey] = labelCounts[labelKey] || { count: 0, samples: [] };
      labelCounts[labelKey].count++;
    });
  }
  
  const countsList = Object.entries(labelCounts)
    .map(([label, data]) => {
      const sampleText = data.samples && data.samples.length > 0 
        ? ` <span class="text-xs text-gray-500">(e.g., ${data.samples[0]})</span>`
        : '';
      return `<li><strong>${label}:</strong> ${data.count}${sampleText}</li>`;
    })
    .join('');
  
  // Display feature mapping info
  const inputFeaturesInfo = featureMapping.inputFeatures.map((feature, idx) => {
    const cols = feature.columns.map(c => `${c.tableName}.${c.columnName}`).join(' + ');
    return `<li><strong>Feature ${idx + 1}:</strong> ${cols}</li>`;
  }).join('');
  
  const outputCols = featureMapping.outputFeature.columns.map(c => `${c.tableName}.${c.columnName}`).join(' + ');
  const outputInfo = outputCols;
  
  // Label mapping info
  let labelMappingInfo = '';
  if (extractedFeatures.labelEncoder) {
    const labels = extractedFeatures.labelEncoder.getAllLabels();
    labelMappingInfo = `
      <div class="mb-4 bg-green-50 border border-green-200 rounded p-3">
        <p class="text-green-800 font-semibold mb-2">✅ Label Encoding Active:</p>
        <p class="text-gray-700 text-sm"><strong>Output Classes:</strong> ${extractedFeatures.outputDimension} (${labels.join(', ')})</p>
        <p class="text-gray-600 text-xs mt-1">Raw values have been encoded to numerical labels for training</p>
      </div>
    `;
  }
  
  dataInfoEl.innerHTML = `
    <div class="mb-4">
      <p class="text-gray-700 font-semibold mb-2">Dataset Summary:</p>
      <p class="text-gray-700"><strong>Total Samples:</strong> ${extractedFeatures.sampleCount}</p>
      <p class="text-gray-700"><strong>Input Dimensions:</strong> ${extractedFeatures.inputDimension}</p>
      <p class="text-gray-700"><strong>Output Dimensions:</strong> ${extractedFeatures.outputDimension}</p>
    </div>
    
    ${labelMappingInfo}
    
    <div class="mb-4">
      <p class="text-gray-700 font-semibold mb-2">Feature Mapping:</p>
      <ul class="list-disc list-inside ml-4 text-gray-600 text-sm">
        ${inputFeaturesInfo}
        <li><strong>Output Label:</strong> ${outputInfo}</li>
      </ul>
    </div>
    
    <div>
      <p class="text-gray-700 font-semibold mb-2">Label Distribution:</p>
      <ul class="list-disc list-inside ml-4 text-gray-600">
        ${countsList}
      </ul>
    </div>
  `;
  
  document.getElementById('startTraining').disabled = false;
  document.getElementById('downloadData').disabled = false;
}

// Prepare tensors from extracted features
function prepareTensors(features) {
  // Filter out rows with unmapped labels
  const validIndices = [];
  features.outputs.forEach((label, idx) => {
    if (label !== -1) {
      validIndices.push(idx);
    }
  });
  
  console.log(`Preparing tensors: ${validIndices.length} valid samples out of ${features.sampleCount}`);
  
  // Extract valid samples
  const validInputs = validIndices.map(idx => features.inputs[idx]);
  const validOutputs = validIndices.map(idx => features.outputs[idx]);
  
  // Convert to tensors
  const xData = tf.tensor2d(validInputs);
  const yData = tf.oneHot(tf.tensor1d(validOutputs, 'int32'), features.outputDimension);
  
  return { xData, yData, validCount: validIndices.length };
}

// Split data into training and validation sets
function splitData(xData, yData, validationSplit) {
  const totalSize = xData.shape[0];
  const trainSize = Math.floor(totalSize * (1 - validationSplit));
  
  // Shuffle indices and convert to tensor
  const indices = tf.util.createShuffledIndices(totalSize);
  const trainIndices = tf.tensor1d(Array.from(indices.slice(0, trainSize)), 'int32');
  const valIndices = tf.tensor1d(Array.from(indices.slice(trainSize)), 'int32');
  
  const xTrain = tf.gather(xData, trainIndices);
  const yTrain = tf.gather(yData, trainIndices);
  const xVal = tf.gather(xData, valIndices);
  const yVal = tf.gather(yData, valIndices);
  
  // Dispose temporary index tensors
  trainIndices.dispose();
  valIndices.dispose();
  
  return { xTrain, yTrain, xVal, yVal };
}

// Train the model
async function trainModel(features, config, statusContainer) {
  console.log('🚀 Starting model training...');
  
  // Prepare tensors
  statusContainer.innerHTML = '<p class="text-indigo-700 font-semibold">📊 Preparing training data...</p>';
  const { xData, yData, validCount } = prepareTensors(features);
  
  console.log(`Training with ${validCount} valid samples`);
  console.log(`Input shape: [${xData.shape}], Output shape: [${yData.shape}]`);
  
  // Split data
  const { xTrain, yTrain, xVal, yVal } = splitData(xData, yData, config.validationSplit);
  
  console.log(`Train: ${xTrain.shape[0]} samples, Validation: ${xVal.shape[0]} samples`);
  
  // Build model
  statusContainer.innerHTML = '<p class="text-indigo-700 font-semibold">🏗️ Building neural network...</p>';
  
  const model = tf.sequential({
    layers: [
      tf.layers.dense({
        inputShape: [xTrain.shape[1]],
        units: 1024,
        activation: 'sigmoid'
      }),
      tf.layers.batchNormalization(),
      tf.layers.dropout({ rate: 0.2 }),
      tf.layers.dense({ units: 64, activation: 'relu' }),
      tf.layers.dense({ units: 8, activation: 'relu' }),
      tf.layers.dense({
        units: features.outputDimension,
        activation: 'softmax'
      })
    ]
  });
  
  model.summary();
  
  // Compile model
  model.compile({
    optimizer: tf.train.adam(config.learningRate),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy']
  });
  
  // Warm up
  const warmupResult = model.predict(xTrain.slice([0, 0], [1, xTrain.shape[1]]));
  warmupResult.dataSync();
  warmupResult.dispose();
  
  // Train model
  const trainLogs = [];
  const beginMs = performance.now();
  
  statusContainer.innerHTML = `
    <div id="training-status-message">
      <p class="text-indigo-700 font-semibold mb-4">🎯 Training model...</p>
    </div>
    <div id="training-progress" class="space-y-4"></div>
    <div class="grid grid-cols-2 gap-4 mt-4">
      <div>
        <h4 class="font-semibold text-gray-700 mb-2">Loss</h4>
        <div id="lossCanvas"></div>
      </div>
      <div>
        <h4 class="font-semibold text-gray-700 mb-2">Accuracy</h4>
        <div id="accuracyCanvas"></div>
      </div>
    </div>
    <div class="mt-4">
      <h4 class="font-semibold text-gray-700 mb-2">Confusion Matrix (Validation Set)</h4>
      <div id="confusion-matrix"></div>
    </div>
  `;
  
  const history = await model.fit(xTrain, yTrain, {
    epochs: config.epochs,
    batchSize: config.batchSize,
    validationData: [xVal, yVal],
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        const secPerEpoch = (performance.now() - beginMs) / (1000 * (epoch + 1));
        const timeToGo = secPerEpoch * (config.epochs - epoch - 1);
        
        trainLogs.push(logs);
        
        // Update progress
        const progressDiv = document.getElementById('training-progress');
        if (progressDiv) {
          const progress = ((epoch + 1) / config.epochs * 100).toFixed(1);
          progressDiv.innerHTML = `
            <div>
              <div class="flex justify-between text-sm mb-2">
                <span class="font-medium">Epoch ${epoch + 1}/${config.epochs}</span>
                <span class="text-gray-600">${progress}% - ${timeToGo.toFixed(1)}s remaining</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-3">
                <div class="bg-indigo-600 h-3 rounded-full transition-all" style="width: ${progress}%"></div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4 text-sm mt-3">
              <div class="bg-blue-50 p-3 rounded">
                <p class="text-gray-600">Training Loss</p>
                <p class="text-xl font-semibold text-blue-700">${logs.loss.toFixed(4)}</p>
              </div>
              <div class="bg-green-50 p-3 rounded">
                <p class="text-gray-600">Training Accuracy</p>
                <p class="text-xl font-semibold text-green-700">${(logs.acc * 100).toFixed(2)}%</p>
              </div>
              <div class="bg-orange-50 p-3 rounded">
                <p class="text-gray-600">Validation Loss</p>
                <p class="text-xl font-semibold text-orange-700">${logs.val_loss.toFixed(4)}</p>
              </div>
              <div class="bg-purple-50 p-3 rounded">
                <p class="text-gray-600">Validation Accuracy</p>
                <p class="text-xl font-semibold text-purple-700">${(logs.val_acc * 100).toFixed(2)}%</p>
              </div>
            </div>
          `;
        }
        
        // Update charts
        const lossContainer = document.getElementById('lossCanvas');
        const accContainer = document.getElementById('accuracyCanvas');
        if (lossContainer && accContainer) {
          tfvis.show.history(lossContainer, trainLogs, ['loss', 'val_loss']);
          tfvis.show.history(accContainer, trainLogs, ['acc', 'val_acc']);
        }
        
        // Update confusion matrix
        await drawConfusionMatrix(model, xVal, yVal, features.labelEncoder);
      }
    }
  });
  
  const secPerEpoch = (performance.now() - beginMs) / (1000 * config.epochs);
  console.log(`✅ Training complete: ${secPerEpoch.toFixed(4)} seconds per epoch`);
  
  // Cleanup
  xData.dispose();
  yData.dispose();
  xTrain.dispose();
  yTrain.dispose();
  xVal.dispose();
  yVal.dispose();
  
  return model;
}

// Draw confusion matrix
async function drawConfusionMatrix(model, xVal, yVal, labelEncoder) {
  const [preds, labels] = tf.tidy(() => {
    const preds = model.predict(xVal).argMax(-1);
    const labels = yVal.argMax(-1);
    return [preds, labels];
  });
  
  const confMatrixData = await tfvis.metrics.confusionMatrix(labels, preds);
  const container = document.getElementById('confusion-matrix');
  
  if (container && labelEncoder) {
    tfvis.render.confusionMatrix(
      container,
      {
        values: confMatrixData,
        labels: labelEncoder.getAllLabels()
      },
      { shadeDiagonal: true }
    );
  }
  
  tf.dispose([preds, labels]);
}

// Save model locally
window.saveModelLocally = async function() {
  if (!model) {
    alert('No model to save. Please train a model first.');
    return;
  }
  
  try {
    await model.save('localstorage://exolix-model');
    alert('✅ Model saved to browser local storage!');
    console.log('Model saved to localstorage://exolix-model');
  } catch (error) {
    console.error('Error saving model:', error);
    alert('❌ Error saving model: ' + error.message);
  }
};

// Start training with TensorFlow.js
document.getElementById('startTraining').addEventListener('click', async () => {
  if (!extractedFeatures || extractedFeatures.sampleCount === 0) {
    alert('No training data available.');
    return;
  }
  
  if (!extractedFeatures.labelEncoder) {
    alert('Label encoding is required for training. Please ensure label mapping is complete.');
    return;
  }
  
  const epochs = parseInt(document.getElementById('epochs').value);
  const learningRate = parseFloat(document.getElementById('learningRate').value);
  const batchSize = parseInt(document.getElementById('batchSize').value);
  const validationSplit = parseFloat(document.getElementById('validationSplit').value);
  
  const config = {
    epochs,
    learningRate,
    batchSize,
    validationSplit
  };
  
  // Disable training button
  document.getElementById('startTraining').disabled = true;
  
  const statusEl = document.getElementById('trainingStatus');
  const statusContent = document.getElementById('statusContent');
  statusEl.classList.remove('hidden');
  
  // Show initial status
  statusContent.innerHTML = `
    <p class="text-indigo-700 font-semibold">🚀 Preparing training data...</p>
  `;
  
  try {
    // Train the model
    model = await trainModel(extractedFeatures, config, statusContent);
    
    // Update status message only (keep charts intact)
    const statusMessage = document.getElementById('training-status-message');
    if (statusMessage) {
      statusMessage.innerHTML = `
        <div class="bg-green-50 border border-green-200 rounded p-4 mb-4">
          <p class="text-green-800 font-semibold">✅ Training Complete!</p>
          <p class="text-green-700 mt-2">Model has been trained successfully.</p>
          <div class="mt-3 flex gap-2">
            <button onclick="saveModelLocally()" class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
              💾 Save Model Locally
            </button>
          </div>
        </div>
      `;
    }
    
  } catch (error) {
    console.error('Training error:', error);
    const statusMessage = document.getElementById('training-status-message');
    if (statusMessage) {
      statusMessage.innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded p-4 mb-4">
          <p class="text-red-800 font-semibold">❌ Training Failed</p>
          <p class="text-red-700 mt-2">${error.message}</p>
        </div>
      `;
    }
  } finally {
    // Re-enable training button
    document.getElementById('startTraining').disabled = false;
  }
});

// Download preprocessed data as CSV
document.getElementById('downloadData').addEventListener('click', () => {
  if (!extractedFeatures || extractedFeatures.sampleCount === 0) {
    alert('No training data available to download.');
    return;
  }
  
  downloadAsCSV();
});

function downloadAsCSV() {
  console.log('Preparing CSV download...');
  
  // Build CSV header - generic feature names matching the actual data structure
  const headers = [];
  
  // Since different tables may have different numbers of mapped columns,
  // we use the first valid row to determine the number of features
  const firstValidRow = extractedFeatures.inputs.find((row, idx) => 
    extractedFeatures.outputs[idx] !== -1
  );
  
  if (!firstValidRow) {
    alert('No valid data to export (all rows have unmapped labels).');
    return;
  }
  
  // Add table column as the first column
  headers.push('table');
  
  // Add generic feature column headers based on actual data dimensions
  for (let i = 0; i < firstValidRow.length; i++) {
    headers.push(`feature_${i + 1}`);
  }
  
  // Add encoded label header
  headers.push('label_encoded');
  
  // Build CSV rows - only clean data
  const rows = [headers.join(',')];
  
  extractedFeatures.inputs.forEach((inputRow, idx) => {
    const encodedLabel = extractedFeatures.outputs[idx];
    
    // Skip rows with unmapped labels (-1)
    if (encodedLabel === -1) {
      return;
    }
    
    // Build row with table name, feature values, and encoded label
    const tableName = extractedFeatures.tableNames[idx];
    const row = [tableName, ...inputRow, encodedLabel];
    
    // Escape values and handle quotes, commas
    const escapedRow = row.map(val => {
      if (val === null || val === undefined) return '';
      const strVal = String(val);
      if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
        return `"${strVal.replace(/"/g, '""')}"`;
      }
      return strVal;
    });
    
    rows.push(escapedRow.join(','));
  });
  
  const csvContent = rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `exolix_preprocessed_data_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  
  console.log(`✅ CSV downloaded with ${rows.length - 1} clean rows (excluded ${extractedFeatures.sampleCount - (rows.length - 1)} unmapped rows)`);
}

// Initialize
(async () => {
  console.log('Initializing training page...');
  
  // Set TensorFlow.js backend
  await tf.setBackend('webgl');
  await tf.ready();
  console.log(`✅ TensorFlow.js backend: ${tf.getBackend()}`);
  
  const loadResult = await loadTrainingData();
  displayDataInfo(loadResult);
  
  if (loadResult.success) {
    console.log('✅ Training page initialized successfully');
  } else {
    console.log('⚠️ Training page initialization incomplete');
  }
})();
