import dataStore from './dataStore.js';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as tfvis from '@tensorflow/tfjs-vis';

// Training page logic
let trainingData = [];
let featureMapping = null;
let extractedFeatures = null;
let model = null;
// Input mode & embedding state now managed externally (promptflow.js)

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
    window.extractedFeatures = extractedFeatures; // make it globally readable (optional but handy)
    document.dispatchEvent(
      new CustomEvent('exolix:preprocessed-ready', {
        detail: {
          sampleCount: extractedFeatures.sampleCount,
          featureCount: extractedFeatures.inputDimension
        }
      })
    );
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



// ---------- Expose preprocessed data to other modules (Prompt Builder)
window.getMappedFeatureMatrix = function () {
  try {
    return (extractedFeatures && Array.isArray(extractedFeatures.inputs)) ? extractedFeatures.inputs : [];
  } catch { return []; }
};

window.getFeatureIndexCount = function () {
  try {
    return (extractedFeatures && extractedFeatures.inputDimension) ? extractedFeatures.inputDimension : 0;
  } catch { return 0; }
};






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
  const outputRawValues = [];
  const tableIndices = [];
  const tableNames = [];

  let labelEncoder = null;
  if (mapping.labelMapping && mapping.labelMapping.targetLabels) {
    labelEncoder = buildLabelEncoder(mapping.labelMapping);
  } else {
    console.warn('⚠️ No label mapping found in feature mapping');
  }

  let skippedCount = 0;

  concatenatedData.forEach(rowData => {
    const record = rowData.record;
    const sourceTableIndex = rowData.tableIndex;

    const inputRow = [];
    mapping.inputFeatures.forEach(feature => {
      const columnForThisTable = feature.columns.find(col => col.tableIndex === sourceTableIndex);
      if (columnForThisTable) {
        const raw = record[columnForThisTable.columnName];
        // Accept blanks or non-numeric: convert to 0.0 rather than skipping row
        if (raw === '' || raw === null || raw === undefined) {
          inputRow.push(0.0);
        } else {
          const num = Number(raw);
            inputRow.push(Number.isFinite(num) ? num : 0.0);
        }
      } else {
        inputRow.push(0.0); // missing feature for this table
      }
    });

    // Output label handling
    const outputColumnForThisTable = mapping.outputFeature.columns.find(c => c.tableIndex === sourceTableIndex);
    let outputValue = null;
    if (outputColumnForThisTable) outputValue = record[outputColumnForThisTable.columnName];
    const outputKey = outputValue !== null && outputValue !== undefined ? outputValue : 'unknown';

    let encodedLabel = -1;
    if (labelEncoder) {
      if (outputValue !== null && outputValue !== undefined) encodedLabel = labelEncoder.encode(outputValue);
      if (encodedLabel === null) encodedLabel = -1;
    } else {
      encodedLabel = outputValue;
    }

    // Only skip if label unmapped; feature invalids converted to zeros
    if (encodedLabel === -1) {
      skippedCount++; return;
    }

    inputFeatures.push(inputRow);
    outputLabels.push(encodedLabel);
    outputRawValues.push(outputKey);
    tableIndices.push(sourceTableIndex);
    tableNames.push(sortedTables[sourceTableIndex].tabName);
  });

  if (skippedCount > 0) {
    console.log(`⚠️ Skipped ${skippedCount} rows due to unmapped labels (feature blanks zero-filled)`);
  }

  return {
    inputs: inputFeatures,
    outputs: outputLabels,
    outputRaw: outputRawValues,
    tableIndices,
    tableNames,
    inputDimension: inputFeatures[0] ? inputFeatures[0].length : 0,
    outputDimension: labelEncoder ? labelEncoder.numClasses : 1,
    sampleCount: inputFeatures.length,
    labelEncoder
  };
}

// Sanitize numeric matrix just before raw training (defensive pass over extractedFeatures.inputs)
function sanitizeRawFeatureMatrix(features) {
  if (!features || !Array.isArray(features.inputs)) return { replaced: 0 };
  let replaced = 0;
  features.inputs.forEach(row => {
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (v === '' || v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) || (typeof v !== 'number')) {
        const num = Number(v);
        if (!Number.isFinite(num)) {
          row[i] = 0.0; replaced++;
        } else if (typeof v !== 'number') {
          row[i] = num; // convert string numeric to number
        }
      }
    }
  });
  if (replaced) console.log(`[training] Sanitized feature matrix: replaced ${replaced} invalid/blank values with 0.0`);
  return { replaced };
}

// Build label encoder from label mapping
function buildLabelEncoder(labelMapping) {
  const valueToIndex = new Map();
  const indexToLabel = new Map();
  
  // Sort target labels by their index to ensure correct order
  const sortedLabels = [...labelMapping.targetLabels].sort((a, b) => {
    const indexA = a.index !== undefined ? a.index : 0;
    const indexB = b.index !== undefined ? b.index : 0;
    return indexA - indexB;
  });
  
  sortedLabels.forEach((label) => {
    // Use the stored index if available, otherwise use array position
    const labelIndex = label.index !== undefined ? label.index : sortedLabels.indexOf(label);
    
    // Map each value to its target label index
    label.mappedValues.forEach(value => {
      valueToIndex.set(value, labelIndex);
    });
    
    // Map index to label name
    indexToLabel.set(labelIndex, label.name);
  });
  
  // Create the simple labels array like ['CONFIRMED', 'FALSE POSITIVE']
  const simpleLabelsArray = [];
  for (let i = 0; i < labelMapping.targetLabels.length; i++) {
    const labelName = indexToLabel.get(i);
    if (labelName) {
      simpleLabelsArray.push(String(labelName));
    } else {
      console.error(`❌ ERROR: No label found for index ${i}!`);
      simpleLabelsArray.push(`Class ${i}`);
    }
  }
  
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
      return simpleLabelsArray;
    }
  };
}

// Display data info
function displayDataInfo(loadResult) {
  const dataInfoEl = document.getElementById('dataInfo');
  
  if (!loadResult || !loadResult.success) {
    dataInfoEl.innerHTML = `
      <div class="empty-state">
        <p>No training data available.</p>
        <div class="empty-instructions">
          Please complete these steps:<br>
          1. Go to <a href="explorer.html" class="link-primary">Explorer</a> and select rows<br>
          2. Click "Send to Training"<br>
          3. Define features in <a href="mapping.html" class="link-primary">Mapping</a><br>
          4. Return here to train
        </div>
        ${loadResult && loadResult.error ? `<div class="empty-error">Error: ${loadResult.error}</div>` : ''}
      </div>
    `;
    document.getElementById('startTraining').disabled = true;
    document.getElementById('downloadData').disabled = true;
    return;
  }
  
  if (!extractedFeatures || extractedFeatures.sampleCount === 0) {
    dataInfoEl.innerHTML = `
      <div class="empty-state">No features extracted.</div>
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
      <div class="label-encoding-badge">
        <p class="badge-title">✅ Label Encoding Active:</p>
        <p class="badge-content"><strong>Output Classes:</strong> ${extractedFeatures.outputDimension} (${labels.join(', ')})</p>
        <p class="badge-note">Raw values have been encoded to numerical labels for training</p>
      </div>
    `;
  }
  
  dataInfoEl.innerHTML = `
    <div class="data-summary">
      <p class="section-title">Dataset Summary:</p>
      <p class="section-content"><strong>Total Samples:</strong> ${extractedFeatures.sampleCount}</p>
      <p class="section-content"><strong>Input Dimensions:</strong> ${extractedFeatures.inputDimension}</p>
      <p class="section-content"><strong>Output Dimensions:</strong> ${extractedFeatures.outputDimension}</p>
    </div>
    
    ${labelMappingInfo}
    
    <div class="data-summary">
      <p class="section-title">Feature Mapping:</p>
      <ul class="section-list" style="font-size: 0.875rem;">
        ${inputFeaturesInfo}
        <li><strong>Output Label:</strong> ${outputInfo}</li>
      </ul>
    </div>
    
    <div class="data-summary">
      <p class="section-title">Label Distribution:</p>
      <ul class="list-disc list-inside ml-4 text-gray-600">
        ${countsList}
      </ul>
    </div>
  `;
  
  document.getElementById('startTraining').disabled = false;
  document.getElementById('downloadData').disabled = false;
}

// Prepare tensors from extracted features (NO NORMALIZATION - matches old implementation)
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
  
  // Create tensors WITHOUT normalization (like old implementation)
  const xData = tf.tensor2d(validInputs, [validInputs.length, validInputs[0].length]);
  
  // Convert outputs to one-hot encoded tensors
  const yData = tf.oneHot(tf.tensor1d(validOutputs, 'int32'), features.outputDimension);
  
  return { 
    xData, 
    yData, 
    validCount: validIndices.length
  };
}

// Helper: Convert subset of data to tensors (matches old convertToTensors)
function convertToTensors(data, targets, testSplit, numClasses) {
  const numExamples = data.length;
  
  // Shuffle indices
  const indices = [];
  for (let i = 0; i < numExamples; ++i) {
    indices.push(i);
  }
  tf.util.shuffle(indices);
  
  const shuffledData = [];
  const shuffledTargets = [];
  for (let i = 0; i < numExamples; ++i) {
    shuffledData.push(data[indices[i]]);
    shuffledTargets.push(targets[indices[i]]);
  }
  
  // Split train/test
  const numTestExamples = Math.round(numExamples * testSplit);
  const numTrainExamples = numExamples - numTestExamples;
  
  const xDims = shuffledData[0].length;
  
  // Create tensors
  const xs = tf.tensor2d(shuffledData, [numExamples, xDims]);
  const ys = tf.oneHot(tf.tensor1d(shuffledTargets).toInt(), numClasses);
  
  // Split using slice
  const xTrain = xs.slice([0, 0], [numTrainExamples, xDims]);
  const xTest = xs.slice([numTrainExamples, 0], [numTestExamples, xDims]);
  const yTrain = ys.slice([0, 0], [numTrainExamples, numClasses]);
  const yTest = ys.slice([numTestExamples, 0], [numTestExamples, numClasses]);
  
  return [xTrain, yTrain, xTest, yTest];
}

// Split data into training and validation sets with stratification (EXACTLY like old implementation)
function splitData(xData, yData, validationSplit, numClasses) {
  return tf.tidy(() => {
    // Get raw data arrays from tensors
    const xArray = xData.arraySync();
    const yArray = yData.argMax(-1).arraySync();
    
    // Group data by class (like old dataByClass)
    const dataByClass = [];
    const targetsByClass = [];
    for (let i = 0; i < numClasses; ++i) {
      dataByClass.push([]);
      targetsByClass.push([]);
    }
    
    for (let i = 0; i < xArray.length; ++i) {
      const target = yArray[i];
      const data = xArray[i];
      dataByClass[target].push(data);
      targetsByClass[target].push(target);
    }
    
    // Group data by class for stratified splitting
    
    // Split each class separately (exactly like old splitData)
    const xTrains = [];
    const yTrains = [];
    const xTests = [];
    const yTests = [];
    
    for (let i = 0; i < numClasses; ++i) {
      const [xTrain, yTrain, xTest, yTest] = 
          convertToTensors(dataByClass[i], targetsByClass[i], validationSplit, numClasses);
      xTrains.push(xTrain);
      yTrains.push(yTrain);
      xTests.push(xTest);
      yTests.push(yTest);
    }
    
    // Concatenate all classes (like old implementation)
    const concatAxis = 0;
    const xTrain = tf.concat(xTrains, concatAxis);
    const yTrain = tf.concat(yTrains, concatAxis);
    const xVal = tf.concat(xTests, concatAxis);
    const yVal = tf.concat(yTests, concatAxis);
    
    // Keep the split data (remove from tidy scope)
    return {
      xTrain: tf.keep(xTrain),
      yTrain: tf.keep(yTrain),
      xVal: tf.keep(xVal),
      yVal: tf.keep(yVal)
    };
  });
}

// Build model architectures (separate legacy raw vs embedding-enhanced)
function buildModel(inputDim, outputDim, mode) {
  // EXACT legacy model (applies to both raw & LLM modes):
  //  Layers: 1024 (sigmoid) -> Dropout(0.2) -> 64 (sigmoid) -> 8 (sigmoid) -> softmax
  //  This intentionally keeps the original smaller mid / deep layers.
  return tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [inputDim], units: 1024, activation: 'sigmoid' }),
      // Add batch normalization
      tf.layers.batchNormalization(),
      tf.layers.dropout({ rate: 0.2 }),
      tf.layers.dense({ units: 64, activation: 'sigmoid' }),
      tf.layers.dense({ units: 8, activation: 'sigmoid' }),
      tf.layers.dense({ units: outputDim, activation: 'softmax' })
    ]
  });
}

// Train the model (features may be original or replaced by embeddingMatrix)
async function trainModel(features, config, statusContainer) {
  console.log('🚀 Starting model training...');

  // NOTE: Defaults aligned to legacy implementation for higher observed accuracy:
  // - Batch size 32 (was 512) tends to improve generalization vs. large batches.
  // - Validation split 0.15 (was 0.20) matches prior stratified holdout.
  // - Feature vectors now zero-filled for missing table columns to keep fixed dimensionality.
  // These adjustments aim to reproduce ~87% accuracy previously achieved.
  
  // Prepare tensors (NO normalization - like old implementation)
  statusContainer.innerHTML = '<p class="status-info">📊 Preparing training data...</p>';
  // Resolve external embedding if mode selected (delegated to promptflow.js)
  let workingFeatures = features;
  try {
    const modeGetter = window.getTrainingInputMode;
    const embGetter = window.getLLMEmbedding;
    const selectedMode = typeof modeGetter === 'function' ? modeGetter() : 'raw';
    if (selectedMode === 'llm-embedding') {
      const emb = typeof embGetter === 'function' ? embGetter() : null;
      if (emb && Array.isArray(emb) && emb.length && Array.isArray(emb[0])) {
        console.log('[training] Using external embedding matrix for training');
        workingFeatures = { ...features, inputs: emb, inputDimension: emb[0].length };
        console.log('[training] Embedding stats rows=', emb.length, 'dims=', emb[0].length);
      } else {
        throw new Error('Embedding mode selected but no embedding available. Generate embedding first.');
      }
    }
  } catch (e) {
    console.warn('[training] Embedding resolution warning:', e.message);
    if (/Embedding mode selected/.test(e.message)) throw e; // escalate fatal condition
  }

  const { xData, yData, validCount } = prepareTensors(workingFeatures);
  
  console.log(`Training with ${validCount} valid samples`);
  console.log(`Input shape: [${xData.shape}], Output shape: [${yData.shape}]`);
  
  // Split data with stratification (maintains class balance in train/val sets)
  const { xTrain, yTrain, xVal, yVal } = splitData(xData, yData, config.validationSplit, workingFeatures.outputDimension);
  
  console.log(`Train: ${xTrain.shape[0]} samples, Validation: ${xVal.shape[0]} samples`);
  
  // Build model
  statusContainer.innerHTML = '<p class="status-info">🏗️ Building neural network...</p>';
  
  if (xTrain.shape[1] !== workingFeatures.inputDimension) {
    console.warn('[training] Dimension mismatch: tensor dim', xTrain.shape[1], 'metadata dim', workingFeatures.inputDimension);
  }
  const model = buildModel(xTrain.shape[1], workingFeatures.outputDimension, 'unified');
  console.log('[training] Legacy model (1024->64->8) firstLayer=', model.layers[0].units, 'inputDim=', xTrain.shape[1]);
  
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
      <p class="status-info" style="margin-bottom: 1rem;">🎯 Training model...</p>
    </div>
    <div id="training-progress" style="display: flex; flex-direction: column; gap: 1rem;"></div>
    <div class="grid-cols-2" style="margin-top: 1rem;">
      <div class="chart-container">
        <h4 class="chart-title">Loss</h4>
        <div id="lossCanvas"></div>
      </div>
      <div class="chart-container">
        <h4 class="chart-title">Accuracy</h4>
        <div id="accuracyCanvas"></div>
      </div>
    </div>
    <div style="margin-top: 1rem;">
      <h4 class="chart-title" style="margin-bottom: 0.5rem;">Confusion Matrix (Validation Set)</h4>
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
            <div class="progress-container">
              <div class="progress-header">
                <span class="progress-label">Epoch ${epoch + 1}/${config.epochs}</span>
                <span class="progress-info">${progress}% - ${timeToGo.toFixed(1)}s remaining</span>
              </div>
              <div class="progress-bar-track">
                <div class="progress-bar-fill" style="width: ${progress}%"></div>
              </div>
            </div>
            <div class="grid-cols-4" style="font-size: 0.875rem; margin-top: 0.75rem;">
              <div class="metric-card card-blue">
                <p class="metric-label">Training Loss</p>
                <p class="metric-value">${logs.loss.toFixed(4)}</p>
              </div>
              <div class="metric-card card-green">
                <p class="metric-label">Training Accuracy</p>
                <p class="metric-value">${(logs.acc * 100).toFixed(2)}%</p>
              </div>
              <div class="metric-card card-orange">
                <p class="metric-label">Validation Loss</p>
                <p class="metric-value">${logs.val_loss.toFixed(4)}</p>
              </div>
              <div class="metric-card card-purple">
                <p class="metric-label">Validation Accuracy</p>
                <p class="metric-value">${(logs.val_acc * 100).toFixed(2)}%</p>
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
        await drawConfusionMatrix(model, xVal, yVal, workingFeatures.labelEncoder);
      }
    }
  });
  
  const secPerEpoch = (performance.now() - beginMs) / (1000 * config.epochs);
  
  // Cleanup tensors
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
  if (!labelEncoder) {
    console.error('❌ No labelEncoder provided!');
    return;
  }
  
  const [preds, labels] = tf.tidy(() => {
    const preds = model.predict(xVal).argMax(-1);
    const labels = yVal.argMax(-1);
    return [preds, labels];
  });
  
  const confMatrixData = await tfvis.metrics.confusionMatrix(labels, preds);
  const container = document.getElementById('confusion-matrix');
  
  if (!container) {
    console.error('❌ Container element not found!');
    tf.dispose([preds, labels]);
    return;
  }
  
  // Get class names and render
  const classNames = labelEncoder.getAllLabels();
  
  tfvis.render.confusionMatrix(
    container,
    {
      values: confMatrixData,
      tickLabels: classNames
    },
    { shadeDiagonal: true }
  );
  
  tf.dispose([preds, labels]);
}

// Save model locally
window.saveModelLocally = async function() {
  if (!model) {
    alert('No model to save. Please train a model first.');
    return;
  }
  await attemptModelSave(model, true);
};

// Robust save helper: prefers IndexedDB (larger quota) then falls back to localStorage, then downloads
async function attemptModelSave(m, showAlerts = false) {
  const tried = [];
  // Try indexeddb first (better for larger models)
  try {
    await m.save('indexeddb://exolix-model');
    console.log('💾 Model saved to indexeddb://exolix-model');
    if (showAlerts) alert('✅ Model saved (IndexedDB).');
    return 'indexeddb://exolix-model';
  } catch (e) { tried.push({ target: 'indexeddb', error: e.message }); }
  // Fallback: localStorage (may hit quota with large embeddings)
  try {
    await m.save('localstorage://exolix-model');
    console.log('💾 Model saved to localstorage://exolix-model');
    if (showAlerts) alert('✅ Model saved (localStorage).');
    return 'localstorage://exolix-model';
  } catch (e) { tried.push({ target: 'localstorage', error: e.message }); }
  // Final fallback: force download so user does not lose result
  try {
    await m.save('downloads://exolix-model');
    console.warn('⚠️ Falling back to download. IndexedDB & localStorage failed.', tried);
    if (showAlerts) alert('⚠️ Storage quota exceeded. Model downloaded instead.');
    return 'downloads://exolix-model';
  } catch (e) {
    console.error('❌ All model save attempts failed', tried, e);
    if (showAlerts) alert('❌ Failed to save model anywhere: ' + e.message);
    return null;
  }
}

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
    <p class="status-info">🚀 Preparing training data...</p>
  `;
  
  try {
    // If in raw mode, ensure numeric matrix (convert blanks/non-numerics to 0.0)
    try {
      const mode = typeof window.getTrainingInputMode === 'function' ? window.getTrainingInputMode() : 'raw';
      if (mode === 'raw') sanitizeRawFeatureMatrix(extractedFeatures);
    } catch (e) { console.warn('[training] Raw data sanitization warning:', e.message); }
    // Train the model
    model = await trainModel(extractedFeatures, config, statusContent);
    
    // Update status message only (keep charts intact)
    const statusMessage = document.getElementById('training-status-message');
    if (statusMessage) {
      statusMessage.innerHTML = `
        <div class="status-success">
          <p class="status-title">✅ Training Complete!</p>
          <p class="status-message text-green-300">Model auto-saved to browser storage.</p>
          <div class="mt-4 p-4 rounded-lg bg-green-900/30 border border-green-700/40">
            <p class="mb-4 text-sm text-green-200">Next: Return to the Data Explorer and press <span class="font-semibold">Predict</span> to apply this model to your selected tables.</p>
            <button id="goToExplorer" class="bg-green-600 hover:bg-green-500 text-white font-medium px-5 py-2 rounded transition">Go to Explorer & Predict</button>
          </div>
        </div>
      `;
    }
    // Auto-save model to local storage
    try {
      const target = await attemptModelSave(model, false);
      if (target) {
        console.log('✅ Model auto-saved to', target);
      } else {
        console.warn('⚠️ Model auto-save failed (all targets).');
      }
    } catch (e) {
      console.error('Auto-save failed:', e);
    }
    // Wire navigation button (now inside statusMessage)
    const goBtn = document.getElementById('goToExplorer');
    if (goBtn) {
      goBtn.addEventListener('click', () => {
        window.location.href = 'explorer.html';
      });
    }
    
  } catch (error) {
    console.error('Training error:', error);
    const statusMessage = document.getElementById('training-status-message');
    if (statusMessage) {
      statusMessage.innerHTML = `
        <div class="status-error">
          <p class="status-title">❌ Training Failed</p>
          <p class="status-message">${error.message}</p>
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
}

// Initialize
(async () => {
  // Set TensorFlow.js backend
  await tf.setBackend('webgl');
  await tf.ready();
  
  const loadResult = await loadTrainingData();
  displayDataInfo(loadResult);

  // Large mode selection buttons wiring (integrates with promptflow public API)
  const inputModeCard = document.getElementById('inputModeCard');
  const promptCard = document.getElementById('promptBuilderCard');
  const startBtn = document.getElementById('startTraining');
  const configCard = document.getElementById('trainingConfigCard');
  const changeModeBtn = document.getElementById('changeModeBtn');
  const modeStatusBar = document.getElementById('modeStatusBar');
  const modeStatusPanel = document.getElementById('modeStatusPanel');
  const modeStatusIcon = document.getElementById('modeStatusIcon');
  const modeStatusTitle = document.getElementById('modeStatusTitle');
  const modeStatusSubtitle = document.getElementById('modeStatusSubtitle');
  function setModeStatus(mode, hasEmbedding) {
    if (!modeStatusPanel) return;
    // Reset base classes then apply variant accent
    modeStatusPanel.className = 'flex flex-1 items-center gap-4 rounded-lg border px-4 py-3 shadow-inner backdrop-blur-sm transition-colors';
    modeStatusPanel.classList.add('border-gray-700/70','bg-gray-800/50');
    let iconText = '--';
    let iconClasses = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold tracking-wide select-none';
    let panelAccent = '';
    if (mode === 'raw') {
      iconText = 'RAW';
      iconClasses += ' bg-blue-600/25 text-blue-300 border border-blue-600/40';
      panelAccent = 'ring-1 ring-inset ring-blue-600/30';
      modeStatusTitle.textContent = 'Raw Feature Mode';
      modeStatusSubtitle.innerHTML = 'Using engineered numeric feature matrix.';
    } else if (mode === 'llm-embedding') {
      iconText = 'LLM';
      const stateColor = hasEmbedding ? 'green' : 'amber';
      iconClasses += hasEmbedding
        ? ' bg-purple-600/25 text-purple-300 border border-purple-600/40'
        : ' bg-purple-600/15 text-purple-200 border border-purple-600/30';
      panelAccent = hasEmbedding ? 'ring-1 ring-inset ring-purple-600/30' : 'ring-1 ring-inset ring-purple-500/20';
      modeStatusTitle.textContent = 'LLM Embedding Mode';
      modeStatusSubtitle.innerHTML = hasEmbedding
        ? '<span class="text-green-300">Embedding ready</span> • Train when configuration is set.'
        : '<span class="text-amber-300">Awaiting embedding</span> • Generate embedding before training.';
    } else {
      iconText = '--';
      iconClasses += ' bg-gray-700 text-gray-300';
      modeStatusTitle.textContent = 'Training Mode';
      modeStatusSubtitle.textContent = 'Select a mode below to begin.';
    }
    modeStatusIcon.textContent = iconText;
    modeStatusIcon.className = iconClasses;
    if (panelAccent) modeStatusPanel.classList.add(...panelAccent.split(' '));
  }
  function revealStartAndConfig(mode) {
    if (mode === 'raw') {
      startBtn?.classList.remove('hidden');
      configCard?.classList.remove('hidden');
    } else if (mode === 'llm-embedding') {
      // Only show start after embeddingReady event
      const emb = typeof window.getLLMEmbedding === 'function' ? window.getLLMEmbedding() : null;
      if (emb && Array.isArray(emb) && emb.length) {
        startBtn?.classList.remove('hidden');
        configCard?.classList.remove('hidden');
      }
    }
  }
  const rawBtn = document.getElementById('chooseRawMode');
  const embBtn = document.getElementById('chooseEmbeddingMode');
  rawBtn?.addEventListener('click', () => {
    if (typeof window.setTrainingInputMode === 'function') window.setTrainingInputMode('raw');
    inputModeCard?.classList.add('hidden');
    promptCard?.classList.add('hidden');
    revealStartAndConfig('raw');
    changeModeBtn?.classList.remove('hidden');
    modeStatusBar?.classList.remove('hidden');
    setModeStatus('raw', false);
  });
  embBtn?.addEventListener('click', () => {
    if (typeof window.setTrainingInputMode === 'function') window.setTrainingInputMode('llm-embedding');
    inputModeCard?.classList.add('hidden');
    promptCard?.classList.remove('hidden');
    // Wait for embedding-ready event to show start
    changeModeBtn?.classList.remove('hidden');
    modeStatusBar?.classList.remove('hidden');
    setModeStatus('llm-embedding', false);
  });
  // React to embedding ready / cleared
  document.addEventListener('exolix:embedding-ready', () => {
    if (typeof window.getTrainingInputMode === 'function' && window.getTrainingInputMode() === 'llm-embedding') {
      startBtn?.classList.remove('hidden');
      configCard?.classList.remove('hidden');
      setModeStatus('llm-embedding', true);
    }
  });
  document.addEventListener('exolix:embedding-cleared', () => {
    if (typeof window.getTrainingInputMode === 'function' && window.getTrainingInputMode() === 'llm-embedding') {
      startBtn?.classList.add('hidden');
      setModeStatus('llm-embedding', false);
    }
  });
  // Change mode handler
  changeModeBtn?.addEventListener('click', () => {
    try { localStorage.removeItem('exolix.train.mode.v1'); } catch {}
    // Clear embedding if we were in embedding mode to avoid stale dimension mismatch
    if (typeof window.getTrainingInputMode === 'function' && window.getTrainingInputMode() === 'llm-embedding') {
      if (typeof window.clearLLMEmbedding === 'function') window.clearLLMEmbedding();
    }
    // Reset visible sections
    startBtn?.classList.add('hidden');
    configCard?.classList.add('hidden');
    promptCard?.classList.add('hidden');
    inputModeCard?.classList.remove('hidden');
    // Keep the button visible so user knows they can cancel again? UX choice: hide to mimic first load.
    changeModeBtn?.classList.add('hidden');
  modeStatusBar?.classList.add('hidden');
  setModeStatus(null, false);
  });
  // Apply persisted mode if any (after wiring)
  try {
    // Only auto-hide chooser if a mode was actually persisted (key exists).
    let persistedMode = null;
    let stored = null;
    try { stored = localStorage.getItem('exolix.train.mode.v1'); } catch {}
    if (stored === '0') persistedMode = 'raw';
    else if (stored === '1') persistedMode = 'llm-embedding';
    if (persistedMode === 'raw') {
      inputModeCard?.classList.add('hidden');
      promptCard?.classList.add('hidden');
      if (typeof window.setTrainingInputMode === 'function') window.setTrainingInputMode('raw');
      revealStartAndConfig('raw');
      changeModeBtn?.classList.remove('hidden');
      modeStatusBar?.classList.remove('hidden');
  setModeStatus('raw', false);
    } else if (persistedMode === 'llm-embedding') {
      inputModeCard?.classList.add('hidden');
      promptCard?.classList.remove('hidden');
      if (typeof window.setTrainingInputMode === 'function') window.setTrainingInputMode('llm-embedding');
      const emb = typeof window.getLLMEmbedding === 'function' ? window.getLLMEmbedding() : null;
      if (emb && emb.length) revealStartAndConfig('llm-embedding');
      changeModeBtn?.classList.remove('hidden');
      modeStatusBar?.classList.remove('hidden');
  setModeStatus('llm-embedding', !!(emb && emb.length));
    }
  } catch {}
})();
