import dataStore from './dataStore.js';

// Dataset Manager for handling multiple CSV files
class DatasetManager {
  constructor() {
    this.currentDataset = null;
  }

  // Parse CSV text into records
  async parseCSV(text, datasetId = null) {
    const lines = text.split('\n').filter(line => !line.startsWith('#') && line.trim());
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim());
    const records = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      if (values.length !== headers.length) continue;
      
      const record = {};
      headers.forEach((header, idx) => {
        const value = values[idx].trim();
        if (value === '') {
          record[header] = null;
        } else {
          const num = Number(value);
          record[header] = isNaN(num) ? value : num;
        }
      });
      records.push(record);
    }
    
    // If datasetId provided, cache the CSV text
    if (datasetId) {
      const filename = `${datasetId}.csv`;
      await dataStore.saveCsvData(filename, text);
      console.log(`Cached uploaded CSV as ${filename}`);
    }
    
    return records;
  }

  // Load a CSV file and cache it
  async loadCSV(url, datasetId) {
    try {
      console.log(`Loading dataset ${datasetId} from ${url}...`);
      
      let text;
      let filename;
      
      // Check if this is an uploaded file (cached with datasetId)
      if (url.startsWith('uploaded://')) {
        filename = `${datasetId}.csv`;
        const cachedCsv = await dataStore.getCsvData(filename);
        
        if (cachedCsv) {
          console.log(`Uploaded CSV loaded from cache: ${filename}`);
          text = cachedCsv.content;
        } else {
          throw new Error('Uploaded file not found in cache. Please re-upload the file.');
        }
      } else {
        // Regular URL - check cache or fetch
        filename = url.split('/').pop();
        const cachedCsv = await dataStore.getCsvData(filename);
        
        if (cachedCsv) {
          console.log(`CSV ${filename} loaded from cache`);
          text = cachedCsv.content;
        } else {
          // Fetch and parse
          const response = await fetch(url);
          text = await response.text();
          
          // Save raw CSV to cache
          await dataStore.saveCsvData(filename, text);
        }
      }
      
      // Parse records (don't save yet - will be saved with internal IDs when selected)
      const records = await this.parseCSV(text);
      console.log(`Parsed ${records.length} records from ${filename}`);
      
      this.currentDataset = datasetId;
      return records;
      
    } catch (error) {
      console.error(`Error loading dataset ${datasetId}:`, error);
      throw error;
    }
  }

  // Get available datasets
  async listDatasets() {
    return await dataStore.listDatasets();
  }

  // Clear a specific dataset
  async clearDataset(datasetId) {
    await dataStore.clearRecords(datasetId);
    console.log(`Dataset ${datasetId} cleared`);
  }

  // Get storage info
  async getStorageInfo() {
    const estimate = await dataStore.getStorageEstimate();
    if (estimate) {
      return {
        used: estimate.usage,
        quota: estimate.quota,
        usedMB: (estimate.usage / 1024 / 1024).toFixed(2),
        quotaMB: (estimate.quota / 1024 / 1024).toFixed(2),
        percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(1)
      };
    }
    return null;
  }
}

export default new DatasetManager();
