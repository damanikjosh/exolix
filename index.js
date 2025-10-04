import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';

// Register all Community features
ModuleRegistry.registerModules([AllCommunityModule]);

import { createGrid } from 'ag-grid-community';

// --- Storage Helpers -------------------------------------------------------
// Keys under which grid data and column defs are stored in localStorage
const STORAGE_KEY = 'exoplanetTrainGridData';
const COLS_KEY = 'exoplanetTrainGridCols';

// Attempt to load an array of row objects from localStorage; returns null if absent/invalid.
function loadStoredData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    console.warn('Failed to parse stored grid data, ignoring.', e);
    return null;
  }
}

// Serialize and store the provided array of row objects; logs a warning if it fails.
function saveStoredData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save grid data to localStorage.', e);
  }
}

// Returns existing stored row data, or seeds storage with defaults
function seedAndLoad(defaultRows) {
  const existing = loadStoredData();
  if (existing) return existing;
  saveStoredData(defaultRows);
  return defaultRows;
}
// Load/storing column definitions
function loadStoredCols() {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    console.warn('Failed to parse stored column defs, ignoring.', e);
    return null;
  }
}
function saveStoredCols(cols) {
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify(cols));
  } catch (e) {
    console.warn('Failed to save column defs to localStorage.', e);
  }
}
// ---------------------------------------------------------------------------

function main() {
  // Define and load rowData and columnDefs
  const defaultRowData = [
    { make: "Tesla", model: "Model Y", price: 64950, electric: true },
    { make: "Ford", model: "F-Series", price: 33850, electric: false },
    { make: "Toyota", model: "Corolla", price: 29600, electric: false }
  ];
  const rowData = seedAndLoad(defaultRowData);
  const defaultColDefs = [
    { headerName: '', checkboxSelection: true, editable: false, headerCheckboxSelection: true, width: 40, pinned: 'left', sortable: false, filter: false, resizable: false },
    { field: "make", headerName: "make", editable: true },
    { field: "model", headerName: "model", editable: true },
    { field: "price", headerName: "price", editable: true, valueParser: p => Number(p.newValue) || p.oldValue },
    { field: "electric", headerName: 'electric', editable: true,
      cellRenderer: 'agCheckboxCellRenderer', cellEditor: 'agCheckboxCellEditor'
    }
  ];
  const columnDefs = loadStoredCols() || defaultColDefs;

  // Will hold the grid and column APIs once ready
  let gridApi = null;
  let columnApi = null;

  // Debounced persistence (avoid multiple writes during rapid edits)
  let persistTimer = null;
  function schedulePersist(immediate = false) {
    if (!gridApi) return; // API not ready yet
    if (persistTimer) clearTimeout(persistTimer);
    if (immediate) return persistAll();
    persistTimer = setTimeout(persistAll, 80); // shorter debounce
  }

  // Helper to pull all row data from the grid and store it
  function persistAll() {
    if (!gridApi) return; // Guard against early calls
    const rows = [];
    gridApi.forEachNode(node => rows.push(node.data));
    saveStoredData(rows);
    console.log('[Grid] Persisted', rows.length, 'rows to localStorage.');
  }

  // grid persistence on cell edits (no skipFlush needed)

  // Grid Options: Contains all of the Data Grid configurations
  const gridOptions = {
    rowData,
    columnDefs,
    defaultColDef: { editable: true, resizable: true, sortable: true, filter: true },
    rowSelection: 'multiple',
    suppressRowClickSelection: false,
    singleClickEdit: true,
    stopEditingWhenCellsLoseFocus: true,
    // Persist after a cell finishes editing
    onCellEditingStopped: () => schedulePersist(),
    onCellValueChanged: (e) => {
      // Basic validation for price
      if (e.colDef.field === 'price' && (isNaN(e.newValue) || e.newValue < 0)) {
        e.node.setDataValue('price', e.oldValue);
        alert('Price must be a positive number.');
        return;
      }
      schedulePersist();
    },
    onRowValueChanged: () => schedulePersist(),
    pagination: true,
    paginationPageSize: 10,
    onGridReady: params => {
      gridApi = params.api;
      columnApi = params.columnApi;
  console.log('[Grid] Loaded data rows:', rowData.length);
  schedulePersist(true);
  // Initialize modal and toolbar now that gridApi is ready
  initModal(params.api, gridOptions, document.getElementById('myGrid'));
  initToolbar(params.api, document.getElementById('myGrid'));
    },
    // Allow header renaming on double-click
    onHeaderCellDoubleClicked: params => {
      // Prevent sort on header double-click
      const domEvent = params.event || params.e;
      if (domEvent && domEvent.stopPropagation) {
        domEvent.stopPropagation();
        domEvent.stopImmediatePropagation();
      }
      // Rename header
      const col = params.column;
      const current = col.getColDef().headerName || col.getColId();
      const newName = prompt('Rename column:', current);
      if (newName != null && newName !== current) {
        col.getColDef().headerName = newName;
        gridApi.refreshHeader();
      }
    }
  };

  // After grid creation, wire up Delete Selected button
  const myGridElement = document.getElementById('myGrid');
  createGrid(myGridElement, gridOptions);

  // Extracted toolbar initialization
  function initToolbar(gridApi, gridContainer) {
    document.getElementById('addRowBtn').addEventListener('click', () => {
      const newItem = { make: '', model: '', price: 0, electric: false };
      const res = gridApi.applyTransaction({ add: [newItem] });
      schedulePersist(true);
      const rowNode = res.add[0];
      gridApi.ensureNodeVisible(rowNode, 'bottom');
      gridApi.startEditingCell({ rowIndex: rowNode.rowIndex, colKey: 'make' });
    });
    document.getElementById('deleteSelectedBtn').addEventListener('click', () => {
      const selected = gridApi.getSelectedRows();
      if (!selected.length) return alert('No rows selected.');
      if (!confirm(`Delete ${selected.length} selected row(s)?`)) return;
      gridApi.applyTransaction({ remove: selected });
      schedulePersist(true);
    });
    document.getElementById('resetDataBtn').addEventListener('click', () => {
      if (!confirm('Reset to original data?')) return;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(COLS_KEY);
      location.reload();
    });
  }

  // Initialize modal logic for editing column names
  function initModal(gridApi, gridOptions, gridContainer) {
    const editBtn = document.getElementById('editColumnsBtn');
    const modal = document.getElementById('columnModal');
    const form = document.getElementById('columnForm');
    const fieldsContainer = document.getElementById('columnFields');
    const cancelBtn = document.getElementById('cancelColumnsBtn');

    if (editBtn && modal && form && fieldsContainer) {
      editBtn.addEventListener('click', () => {
        fieldsContainer.innerHTML = '';
        gridOptions.columnDefs.forEach(def => {
          if (def.field) {
            const label = document.createElement('label');
            label.textContent = def.field;
            const input = document.createElement('input');
            input.type = 'text';
            input.name = def.field;
            input.value = def.headerName || def.field;
            input.style.width = '100%';
            fieldsContainer.appendChild(label);
            fieldsContainer.appendChild(input);
          }
        });
        modal.style.display = 'flex';
      });
      cancelBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });
      form.addEventListener('submit', e => {
        e.preventDefault();
        const formData = new FormData(form);
        const newDefs = gridOptions.columnDefs.map(def => {
          if (def.field && formData.has(def.field)) {
            def.headerName = formData.get(def.field);
          }
          return def;
        });
        gridOptions.columnDefs = newDefs;
        saveStoredCols(newDefs);
        gridContainer.innerHTML = '';
        createGrid(gridContainer, gridOptions);
        modal.style.display = 'none';
      });
    }
  }

  // Expose debug helpers (after grid init so api exists soon after microtask)
  window.dumpSelectedRows = () => {
    if (!gridApi) return console.log('Grid API not ready');
    console.log(gridApi.getSelectedRows());
  };
  window.dumpStoredGrid = () => console.log(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  window.resetGridData = () => { localStorage.removeItem(STORAGE_KEY); location.reload(); };
}

main();

// Grid Options: Contains all of the Data Grid configurations
