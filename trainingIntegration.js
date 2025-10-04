// Example: How to integrate TensorFlow.js training with the selected data

import * as tf from '@tensorflow/tfjs';
import { getData, splitData, CLASSES, FEATURES_COLUMN_NAMES, LABEL_COLUMN_NAMES } from './data.js';

/**
 * Convert selected rows from Data Explorer into training tensors
 * @param {Array} trainingData - Selected rows from sessionStorage
 * @param {Object} config - Training configuration
 */
export async function trainModel(trainingData, config) {
  // 1. Extract column headers from first row
  const headers = Object.keys(trainingData[0]);
  
  // 2. Find indices for features and label
  const featureColumnNames = FEATURES_COLUMN_NAMES.flat();
  const labelColumnName = LABEL_COLUMN_NAMES[0];
  
  const featureIndices = featureColumnNames
    .map(name => headers.indexOf(name))
    .filter(idx => idx !== -1);
  
  const labelIndex = headers.indexOf(labelColumnName);
  
  // 3. Convert to array format expected by getData()
  const dataArray = trainingData.map(row => 
    headers.map(header => row[header])
  );
  
  // 4. Process data (filter NaN, encode labels)
  const processedData = getData(dataArray, featureIndices, labelIndex);
  
  // 5. Split into train/test sets
  const [xTrain, yTrain, xTest, yTest] = splitData(processedData, config.validationSplit);
  
  // 6. Create model
  const model = tf.sequential({
    layers: [
      tf.layers.dense({
        inputShape: [xTrain.shape[1]],
        units: 64,
        activation: 'relu'
      }),
      tf.layers.dropout({ rate: 0.2 }),
      tf.layers.dense({
        units: 32,
        activation: 'relu'
      }),
      tf.layers.dense({
        units: CLASSES.length,
        activation: 'softmax'
      })
    ]
  });
  
  // 7. Compile model
  model.compile({
    optimizer: tf.train.adam(config.learningRate),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy']
  });
  
  // 8. Train model
  const history = await model.fit(xTrain, yTrain, {
    epochs: config.epochs,
    batchSize: config.batchSize,
    validationData: [xTest, yTest],
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        console.log(`Epoch ${epoch + 1}/${config.epochs}`);
        console.log(`Loss: ${logs.loss.toFixed(4)}, Accuracy: ${logs.acc.toFixed(4)}`);
        console.log(`Val Loss: ${logs.val_loss.toFixed(4)}, Val Accuracy: ${logs.val_acc.toFixed(4)}`);
        
        // Update UI here
        updateTrainingProgress(epoch + 1, config.epochs, logs);
      }
    }
  });
  
  return { model, history, xTest, yTest };
}

/**
 * Update training progress in the UI
 */
function updateTrainingProgress(epoch, totalEpochs, logs) {
  const statusContent = document.getElementById('statusContent');
  
  if (!statusContent) return;
  
  const progressHtml = `
    <div class="mb-4">
      <div class="flex justify-between mb-2">
        <span>Epoch ${epoch}/${totalEpochs}</span>
        <span>${Math.round((epoch/totalEpochs) * 100)}%</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="bg-indigo-600 h-2 rounded-full" style="width: ${(epoch/totalEpochs) * 100}%"></div>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <p class="text-gray-600">Training Loss:</p>
        <p class="text-lg font-semibold">${logs.loss.toFixed(4)}</p>
      </div>
      <div>
        <p class="text-gray-600">Training Accuracy:</p>
        <p class="text-lg font-semibold">${(logs.acc * 100).toFixed(2)}%</p>
      </div>
      <div>
        <p class="text-gray-600">Validation Loss:</p>
        <p class="text-lg font-semibold">${logs.val_loss.toFixed(4)}</p>
      </div>
      <div>
        <p class="text-gray-600">Validation Accuracy:</p>
        <p class="text-lg font-semibold">${(logs.val_acc * 100).toFixed(2)}%</p>
      </div>
    </div>
  `;
  
  statusContent.innerHTML = progressHtml;
}

/**
 * Example usage in training.js:
 * 
 * import { trainModel } from './trainingIntegration.js';
 * 
 * document.getElementById('startTraining').addEventListener('click', async () => {
 *   const epochs = parseInt(document.getElementById('epochs').value);
 *   const learningRate = parseFloat(document.getElementById('learningRate').value);
 *   const batchSize = parseInt(document.getElementById('batchSize').value);
 *   const validationSplit = parseFloat(document.getElementById('validationSplit').value);
 *   
 *   const config = { epochs, learningRate, batchSize, validationSplit };
 *   
 *   // Show training status
 *   document.getElementById('trainingStatus').classList.remove('hidden');
 *   
 *   // Train model
 *   const { model, history, xTest, yTest } = await trainModel(trainingData, config);
 *   
 *   // Evaluate model
 *   const evaluation = model.evaluate(xTest, yTest);
 *   const testAcc = evaluation[1].dataSync()[0];
 *   console.log(`Test Accuracy: ${(testAcc * 100).toFixed(2)}%`);
 *   
 *   // Save model
 *   await model.save('localstorage://exolix-model');
 * });
 */
