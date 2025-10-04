/**
 * @license
 * Copyright 2018 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as tf from '@tensorflow/tfjs';
import { parse } from "csv-parse/lib/sync";

export const CLASSES =
    ['CONFIRMED', 'FALSE POSITIVE'];
export const NUM_CLASSES = CLASSES.length;
// # COLUMN kepid:          KepID
// # COLUMN kepoi_name:     KOI Name
// # COLUMN kepler_name:    Kepler Name
// # COLUMN koi_disposition: Exoplanet Archive Disposition
// # COLUMN koi_pdisposition: Disposition Using Kepler Data
// # COLUMN koi_score:      Disposition Score
// # COLUMN koi_fpflag_nt:  Not Transit-Like False Positive Flag
// # COLUMN koi_fpflag_ss:  Stellar Eclipse False Positive Flag
// # COLUMN koi_fpflag_co:  Centroid Offset False Positive Flag
// # COLUMN koi_fpflag_ec:  Ephemeris Match Indicates Contamination False Positive Flag
// # COLUMN koi_period:     Orbital Period [days]
// # COLUMN koi_period_err1: Orbital Period Upper Unc. [days]
// # COLUMN koi_period_err2: Orbital Period Lower Unc. [days]
// # COLUMN koi_time0bk:    Transit Epoch [BKJD]
// # COLUMN koi_time0bk_err1: Transit Epoch Upper Unc. [BKJD]
// # COLUMN koi_time0bk_err2: Transit Epoch Lower Unc. [BKJD]
// # COLUMN koi_impact:     Impact Parameter
// # COLUMN koi_impact_err1: Impact Parameter Upper Unc.
// # COLUMN koi_impact_err2: Impact Parameter Lower Unc.
// # COLUMN koi_duration:   Transit Duration [hrs]
// # COLUMN koi_duration_err1: Transit Duration Upper Unc. [hrs]
// # COLUMN koi_duration_err2: Transit Duration Lower Unc. [hrs]
// # COLUMN koi_depth:      Transit Depth [ppm]
// # COLUMN koi_depth_err1: Transit Depth Upper Unc. [ppm]
// # COLUMN koi_depth_err2: Transit Depth Lower Unc. [ppm]
// # COLUMN koi_prad:       Planetary Radius [Earth radii]
// # COLUMN koi_prad_err1:  Planetary Radius Upper Unc. [Earth radii]
// # COLUMN koi_prad_err2:  Planetary Radius Lower Unc. [Earth radii]
// # COLUMN koi_teq:        Equilibrium Temperature [K]
// # COLUMN koi_teq_err1:   Equilibrium Temperature Upper Unc. [K]
// # COLUMN koi_teq_err2:   Equilibrium Temperature Lower Unc. [K]
// # COLUMN koi_insol:      Insolation Flux [Earth flux]
// # COLUMN koi_insol_err1: Insolation Flux Upper Unc. [Earth flux]
// # COLUMN koi_insol_err2: Insolation Flux Lower Unc. [Earth flux]
// # COLUMN koi_model_snr:  Transit Signal-to-Noise
// # COLUMN koi_tce_plnt_num: TCE Planet Number
// # COLUMN koi_tce_delivname: TCE Delivery
// # COLUMN koi_steff:      Stellar Effective Temperature [K]
// # COLUMN koi_steff_err1: Stellar Effective Temperature Upper Unc. [K]
// # COLUMN koi_steff_err2: Stellar Effective Temperature Lower Unc. [K]
// # COLUMN koi_slogg:      Stellar Surface Gravity [log10(cm/s**2)]
// # COLUMN koi_slogg_err1: Stellar Surface Gravity Upper Unc. [log10(cm/s**2)]
// # COLUMN koi_slogg_err2: Stellar Surface Gravity Lower Unc. [log10(cm/s**2)]
// # COLUMN koi_srad:       Stellar Radius [Solar radii]
// # COLUMN koi_srad_err1:  Stellar Radius Upper Unc. [Solar radii]
// # COLUMN koi_srad_err2:  Stellar Radius Lower Unc. [Solar radii]
// # COLUMN ra:             RA [decimal degrees]
// # COLUMN dec:            Dec [decimal degrees]
// # COLUMN koi_kepmag:     Kepler-band [mag]
export const FEATURES = [
  'Orbital Period',
  'Impact Parameter',
  'Transit Duration',
  'Transit Depth',
  'Planetary Radius',
  'Equilibrium Temperature',
  'Insolation Flux',
  'Stellar Effective Temperature',
  'Stellar Surface Gravity',
  'Stellar Radius',
  'RA',
  'Dec',
  'Kepler-band'
];
export const LABEL = 'Disposition';

export const FEATURES_COLUMN_NAMES = [
  ['koi_period'],
  ['koi_impact'],
  ['koi_duration'],
  ['koi_depth'],
  ['koi_prad'],
  ['koi_teq'],
  ['koi_insol'],
  ['koi_steff'],
  ['koi_slogg'],
  ['koi_srad'],
  ['ra'],
  ['dec'],
  ['koi_kepmag']
];
export const LABEL_COLUMN_NAMES = ['koi_disposition'];

function convertToTensors(data, targets, testSplit) {
  const numExamples = data.length;
  if (numExamples !== targets.length) {
    throw new Error('data and split have different numbers of examples');
  }

  // Randomly shuffle `data` and `targets`.
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

  // Split the data into a training set and a tet set, based on `testSplit`.
  const numTestExamples = Math.round(numExamples * testSplit);
  const numTrainExamples = numExamples - numTestExamples;

  const xDims = shuffledData[0].length;

  // Create a 2D `tf.Tensor` to hold the feature data.
  const xs = tf.tensor2d(shuffledData, [numExamples, xDims]);

  // Create a 1D `tf.Tensor` to hold the labels, and convert the number label
  // from the set {0, 1, 2} into one-hot encoding (.e.g., 0 --> [1, 0, 0]).
  const ys = tf.oneHot(tf.tensor1d(shuffledTargets).toInt(), CLASSES.length);

  // Split the data into training and test sets, using `slice`.
  const xTrain = xs.slice([0, 0], [numTrainExamples, xDims]);
  const xTest = xs.slice([numTrainExamples, 0], [numTestExamples, xDims]);
  const yTrain = ys.slice([0, 0], [numTrainExamples, CLASSES.length]);
  const yTest = ys.slice([0, 0], [numTestExamples, CLASSES.length]);
  return [xTrain, yTrain, xTest, yTest];
}

/**
 * Obtains Iris data, split into training and test sets.
 *
 * @param testSplit Fraction of the data at the end to split as test data: a
 *   number between 0 and 1.
 *
 * @param return A length-4 `Array`, with
 *   - training data as an `Array` of length-4 `Array` of numbers.
 *   - training labels as an `Array` of numbers, with the same length as the
 *     return training data above. Each element of the `Array` is from the set
 *     {0, 1, 2}.
 *   - test data as an `Array` of length-4 `Array` of numbers.
 *   - test labels as an `Array` of numbers, with the same length as the
 *     return test data above. Each element of the `Array` is from the set
 *     {0, 1, 2}.
 */
export function splitData(data, testSplit) {
  return tf.tidy(() => {
    const dataByClass = [];
    const targetsByClass = [];
    for (let i = 0; i < CLASSES.length; ++i) {
      dataByClass.push([]);
      targetsByClass.push([]);
    }
    for (const example of data) {
      const target = example[example.length - 1];
      const data = example.slice(0, example.length - 1);
      dataByClass[target].push(data);
      targetsByClass[target].push(target);
    }

    const xTrains = [];
    const yTrains = [];
    const xTests = [];
    const yTests = [];
    for (let i = 0; i < CLASSES.length; ++i) {
      const [xTrain, yTrain, xTest, yTest] =
          convertToTensors(dataByClass[i], targetsByClass[i], testSplit);
      xTrains.push(xTrain);
      yTrains.push(yTrain);
      xTests.push(xTest);
      yTests.push(yTest);
    }

    const concatAxis = 0;
    return [
      tf.concat(xTrains, concatAxis), tf.concat(yTrains, concatAxis),
      tf.concat(xTests, concatAxis), tf.concat(yTests, concatAxis)
    ];
  });
}


export function parseCsvData(csvString, columns = false) {
  const records = parse(csvString, {
    delimiter: ',',
    columns: columns,
    skip_empty_lines: true,
    trim: true,
    comment: '#'
  });
  if (!records.length) return [];
  const columnOrder = Object.keys(records[0]);
  return records.map(record => columnOrder.map(col => record[col]));
}

export function getData(dataArray, featureIndices, labelIndex) {
  const data = [];
  const targets = [];
  for (const row of dataArray) {
    const rowData = featureIndices.map(i => parseFloat(row[i]));
    if (rowData.some(x => isNaN(x))) {
      // Skip rows with NaN feature data.
      continue;
    }
    const label = row[labelIndex];
    if (label === '' || label == null) {
      // Skip rows with empty string or null label.
      continue;
    }
    const labelIndexInClasses = CLASSES.indexOf(label);
    if (labelIndexInClasses === -1) {
      // Skip rows with unrecognized label.
      continue;
    }
    data.push(rowData);
    targets.push(labelIndexInClasses);
  }
  // Concat the data and targets as the last column.
  return data.map((d, i) => [...d, targets[i]]);;
}