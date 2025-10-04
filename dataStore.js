// IndexedDB wrapper for storing training data and CSV files
class DataStore {
  constructor() {
    this.dbName = 'ExoLiXDB';
    this.version = 2; // Incremented for persistentTables store
    this.db = null;
  }

  // Initialize the database
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store for selected training data
        if (!db.objectStoreNames.contains('trainingSelections')) {
          const selectionStore = db.createObjectStore('trainingSelections', { keyPath: 'id' });
          selectionStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Store for cached CSV data
        if (!db.objectStoreNames.contains('csvData')) {
          const csvStore = db.createObjectStore('csvData', { keyPath: 'filename' });
          csvStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Store for parsed records (large datasets)
        if (!db.objectStoreNames.contains('records')) {
          const recordStore = db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
          recordStore.createIndex('datasetId', 'datasetId', { unique: false });
          recordStore.createIndex('kepid', 'kepid', { unique: false });
        }

        // Store for persistent tables (new)
        if (!db.objectStoreNames.contains('persistentTables')) {
          const tablesStore = db.createObjectStore('persistentTables', { keyPath: 'datasetId' });
          tablesStore.createIndex('timestamp', 'timestamp', { unique: false });
          tablesStore.createIndex('name', 'name', { unique: false });
        }
      };
    });
  }

  // Save selected training data (supports multiple tables)
  async saveTrainingSelection(selectionData) {
    await this.init();
    
    console.log('💾 saveTrainingSelection called with', selectionData.tables?.length, 'tables');
    
    // Save records to records store first
    if (selectionData.tables) {
      for (const table of selectionData.tables) {
        if (table.selectedRecords && table.selectedRecords.length > 0) {
          console.log(`💾 Saving ${table.selectedRecords.length} records for ${table.datasetId}...`);
          const result = await this.saveRecords(table.selectedRecords, table.datasetId);
          console.log(`✅ Saved records:`, result);
        } else {
          console.warn(`⚠️ No records to save for ${table.datasetId}`);
        }
      }
    }
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['trainingSelections'], 'readwrite');
      const store = transaction.objectStore('trainingSelections');
      
      const data = {
        id: 'current',
        tables: selectionData.tables ? selectionData.tables.map(t => ({
          datasetId: t.datasetId,
          selectedIds: t.selectedIds,
          columns: t.columns,
          tabName: t.tabName,
          tabOrder: t.tabOrder
        })) : [], // Strip selectedRecords to save space
        timestamp: Date.now(),
        totalCount: selectionData.tables ? 
          selectionData.tables.reduce((sum, t) => sum + t.selectedIds.length, 0) : 0
      };

      const request = store.put(data);
      request.onsuccess = () => resolve(data);
      request.onerror = () => reject(request.error);
    });
  }

  // Get current training selection
  async getTrainingSelection() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['trainingSelections'], 'readonly');
      const store = transaction.objectStore('trainingSelections');
      const request = store.get('current');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Save feature mapping configuration
  async saveFeatureMapping(featureMapping) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['trainingSelections'], 'readwrite');
      const store = transaction.objectStore('trainingSelections');
      
      const data = {
        id: 'featureMapping',
        mapping: featureMapping,
        timestamp: Date.now()
      };

      const request = store.put(data);
      request.onsuccess = () => resolve(data);
      request.onerror = () => reject(request.error);
    });
  }

  // Get feature mapping configuration
  async getFeatureMapping() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['trainingSelections'], 'readonly');
      const store = transaction.objectStore('trainingSelections');
      const request = store.get('featureMapping');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Save CSV data (raw text)
  async saveCsvData(filename, csvText) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['csvData'], 'readwrite');
      const store = transaction.objectStore('csvData');
      
      const data = {
        filename,
        content: csvText,
        timestamp: Date.now(),
        size: csvText.length
      };

      const request = store.put(data);
      request.onsuccess = () => resolve(data);
      request.onerror = () => reject(request.error);
    });
  }

  // Get CSV data
  async getCsvData(filename) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['csvData'], 'readonly');
      const store = transaction.objectStore('csvData');
      const request = store.get(filename);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Save parsed records (batch insert for large datasets)
  async saveRecords(records, datasetId = 'default') {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['records'], 'readwrite');
      const store = transaction.objectStore('records');
      
      let completed = 0;
      const total = records.length;

      records.forEach(record => {
        const data = {
          ...record,
          datasetId,
          id: record.__internalId // Use internal ID as primary key
        };
        
        // Use put instead of add to allow updates
        const request = store.put(data);
        request.onsuccess = () => {
          completed++;
          if (completed === total) {
            resolve({ count: total, datasetId });
          }
        };
        request.onerror = () => {
          console.error('Error saving record:', request.error);
        };
      });

      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Get records by IDs (using internal IDs)
  async getRecordsByIds(internalIds, datasetId = 'default') {
    await this.init();
    console.log(`🔍 Getting records for ${datasetId}, looking for ${internalIds?.length} IDs`);
    console.log('First 3 IDs:', internalIds?.slice(0, 3));
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['records'], 'readonly');
      const store = transaction.objectStore('records');
      const index = store.index('datasetId');
      const request = index.getAll(datasetId);

      request.onsuccess = () => {
        const allRecords = request.result;
        console.log(`📦 Found ${allRecords.length} total records for ${datasetId}`);
        if (allRecords.length > 0) {
          console.log('First record __internalId:', allRecords[0]?.__internalId);
          console.log('First record sample:', allRecords[0]);
        }
        
        const idSet = new Set(internalIds);
        // Use __internalId for filtering instead of kepid
        const filtered = allRecords.filter(record => idSet.has(record.__internalId));
        console.log(`✅ Filtered to ${filtered.length} matching records`);
        resolve(filtered);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Get all records for a dataset
  async getAllRecords(datasetId = 'default') {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['records'], 'readonly');
      const store = transaction.objectStore('records');
      const index = store.index('datasetId');
      const request = index.getAll(datasetId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Clear all records for a dataset
  async clearRecords(datasetId = 'default') {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['records'], 'readwrite');
      const store = transaction.objectStore('records');
      const index = store.index('datasetId');
      const request = index.openCursor(IDBKeyRange.only(datasetId));

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // List all available datasets
  async listDatasets() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['csvData'], 'readonly');
      const store = transaction.objectStore('csvData');
      const request = store.getAll();

      request.onsuccess = () => {
        const datasets = request.result.map(item => ({
          filename: item.filename,
          size: item.size,
          timestamp: item.timestamp
        }));
        resolve(datasets);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Get database size estimate
  async getStorageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      return await navigator.storage.estimate();
    }
    return null;
  }

  // Clear all data
  async clearAll() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        ['trainingSelections', 'csvData', 'records', 'persistentTables'], 
        'readwrite'
      );

      ['trainingSelections', 'csvData', 'records', 'persistentTables'].forEach(storeName => {
        const store = transaction.objectStore(storeName);
        store.clear();
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Save persistent table metadata
  async savePersistentTable(tableData) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['persistentTables'], 'readwrite');
      const store = transaction.objectStore('persistentTables');
      
      const data = {
        datasetId: tableData.datasetId,
        name: tableData.name,
        url: tableData.url,
        columns: tableData.columns,
        rowCount: tableData.rowCount,
        timestamp: Date.now()
      };

      const request = store.put(data);
      request.onsuccess = () => resolve(data);
      request.onerror = () => reject(request.error);
    });
  }

  // Get all persistent tables
  async getAllPersistentTables() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['persistentTables'], 'readonly');
      const store = transaction.objectStore('persistentTables');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // Get single persistent table
  async getPersistentTable(datasetId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['persistentTables'], 'readonly');
      const store = transaction.objectStore('persistentTables');
      const request = store.get(datasetId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Delete persistent table
  async deletePersistentTable(datasetId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['persistentTables', 'records'], 'readwrite');
      
      // Delete table metadata
      const tablesStore = transaction.objectStore('persistentTables');
      tablesStore.delete(datasetId);
      
      // Delete associated records
      const recordsStore = transaction.objectStore('records');
      const index = recordsStore.index('datasetId');
      const request = index.openCursor(IDBKeyRange.only(datasetId));
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

// Create singleton instance
const dataStore = new DataStore();

export default dataStore;
