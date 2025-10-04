# ExoLiX Architecture

## Page Flow

```
┌─────────────────┐
│   index.html    │
│   (Redirect)    │
└────────┬────────┘
         │
         v
┌─────────────────────────────────┐
│      landing.html               │
│  ┌────────────────────────────┐ │
│  │  Hero Section              │ │
│  │  - Project title           │ │
│  │  - Description             │ │
│  │  - CTA buttons             │ │
│  └────────────────────────────┘ │
│  ┌────────────────────────────┐ │
│  │  Features (3 cards)        │ │
│  └────────────────────────────┘ │
│  ┌────────────────────────────┐ │
│  │  About ExoLiX              │ │
│  └────────────────────────────┘ │
│  ┌────────────────────────────┐ │
│  │  Team Placeholder          │ │
│  └────────────────────────────┘ │
└─────────────┬───────────────────┘
              │
              │ "Explore Data"
              v
┌──────────────────────────────────┐
│       data.html                  │
│  ┌────────────────────────────┐  │
│  │ Toolbar                    │  │
│  │ [Selection Count] [Button] │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ AG Grid Table              │  │
│  │ ☐ KepID | Name | Disp ...  │  │
│  │ ☐ 10797  | K00  | CONF ...  │  │
│  │ ☐ 10811  | K01  | FALSE ... │  │
│  │ ... (pagination)           │  │
│  └────────────────────────────┘  │
└─────────────┬────────────────────┘
              │
              │ "Send to Training"
              │ (stores data in sessionStorage)
              v
┌──────────────────────────────────┐
│     training.html                │
│  ┌────────────────────────────┐  │
│  │ Dataset Statistics         │  │
│  │ - Total samples: 1234      │  │
│  │ - CONFIRMED: 567           │  │
│  │ - FALSE POSITIVE: 432      │  │
│  │ - CANDIDATE: 235           │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ Training Configuration     │  │
│  │ Epochs: [50]               │  │
│  │ Learning Rate: [0.001]     │  │
│  │ Batch Size: [32]           │  │
│  │ Validation Split: [0.2]    │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ [Start Training] [Back]    │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ Training Status (hidden)   │  │
│  │ - Progress bar             │  │
│  │ - Metrics                  │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

## Data Flow

```
CSV File (static/cumulative_2025.09.29_21.37.15.csv)
    │
    v
dataExplorer.js
    │
    ├─> Parse CSV
    │   └─> Skip comments (#)
    │   └─> Parse columns
    │   └─> Cast numbers
    │
    ├─> Load into AG Grid
    │   └─> Apply column definitions
    │   └─> Enable checkboxes
    │   └─> Add color coding
    │
    └─> User selects rows
        │
        v
    Click "Send to Training"
        │
        ├─> Get selected rows: gridApi.getSelectedRows()
        │
        ├─> Convert to JSON: JSON.stringify(selected)
        │
        ├─> Store: sessionStorage.setItem('trainingData', json)
        │
        └─> Navigate to training.html
            │
            v
        training.js
            │
            ├─> Load: sessionStorage.getItem('trainingData')
            │
            ├─> Parse: JSON.parse(stored)
            │
            ├─> Display statistics
            │
            └─> On "Start Training"
                │
                ├─> Get configuration
                │
                ├─> trainingData array available
                │
                └─> [Ready for TensorFlow.js]
                    │
                    v
                trainingIntegration.js (example)
                    │
                    ├─> Extract features & labels
                    │
                    ├─> Process data (getData)
                    │
                    ├─> Split train/test (splitData)
                    │
                    ├─> Build model
                    │
                    ├─> Train model
                    │
                    └─> Evaluate & save
```

## File Structure

```
exoplanet-train/
│
├── UI Layer (Pages)
│   ├── index.html          → Redirect to landing
│   ├── landing.html        → Landing page (Tailwind CSS)
│   ├── data.html           → Data explorer page
│   └── training.html       → Training interface
│
├── Logic Layer (JavaScript)
│   ├── dataExplorer.js     → AG Grid + CSV loading + selection
│   ├── training.js         → Training UI logic + data display
│   ├── trainingIntegration.js → Example TensorFlow.js integration
│   ├── data.js             → Data processing utilities (existing)
│   ├── loader.js           → CSV loader (existing)
│   └── train.js            → Training logic (existing)
│
├── Assets
│   ├── static/
│   │   └── cumulative_2025.09.29_21.37.15.csv
│   └── scss/
│       ├── style.scss
│       └── _material-components-web.scss
│
└── Documentation
    ├── README.md           → Original README
    ├── PROJECT_README.md   → Project documentation
    ├── QUICK_START.md      → Quick start guide
    └── ARCHITECTURE.md     → This file
```

## Technology Stack

```
Frontend Framework
    └── Vanilla JavaScript (ES6+)
        ├── Modules
        ├── Async/Await
        └── sessionStorage API

CSS Framework
    └── Tailwind CSS (CDN)
        ├── Utility classes
        ├── Responsive design
        └── Custom colors

Data Grid
    └── AG Grid Community
        ├── Column definitions
        ├── Row selection
        ├── Filtering
        ├── Sorting
        └── Pagination

ML Framework
    └── TensorFlow.js
        ├── Model building
        ├── Training
        └── Evaluation

Build Tool
    └── Parcel
        ├── Module bundling
        ├── SCSS compilation
        └── Dev server

Data Parsing
    └── csv-parse
        ├── CSV parsing
        ├── Column mapping
        └── Type casting
```

## Key Design Decisions

### 1. **No Complex Framework**
- Used vanilla JavaScript instead of React/Vue
- Simpler, cleaner, easier to understand
- Faster development
- No build complexity

### 2. **Tailwind CSS via CDN**
- No build step needed
- Consistent styling
- Responsive by default
- Small file size

### 3. **sessionStorage for Data Transfer**
- Simple data passing between pages
- No need for state management library
- Data persists during session
- Easy to debug (check in DevTools)

### 4. **AG Grid Community**
- Free, full-featured data grid
- Built-in checkbox selection
- Column filtering & sorting
- Pagination support
- Professional appearance

### 5. **Separation of Concerns**
- Each page has its own JS file
- Data processing in separate utilities
- Training logic can be swapped
- Easy to maintain

### 6. **Integration Ready**
- Original code preserved
- New system works alongside existing
- Clear integration points
- Example code provided

## User Experience Flow

```
1. Landing Page
   │
   ├─> User reads about ExoLiX
   │
   └─> Clicks "Explore Data"
       │
       v

2. Data Explorer
   │
   ├─> User sees 9000+ KOI observations
   │
   ├─> Can filter by disposition, name, etc.
   │
   ├─> Selects rows with checkboxes
   │   ├─> Click individual rows
   │   └─> Or click header to select all
   │
   ├─> Sees selection count update
   │
   └─> Clicks "Send to Training"
       │
       v

3. Training Interface
   │
   ├─> User sees selected data statistics
   │   ├─> Total samples
   │   └─> Distribution by class
   │
   ├─> Configures hyperparameters
   │   ├─> Epochs
   │   ├─> Learning rate
   │   ├─> Batch size
   │   └─> Validation split
   │
   └─> Clicks "Start Training"
       │
       └─> [TensorFlow.js trains model]
           │
           ├─> Progress bar updates
           ├─> Metrics displayed
           └─> Model saved
```

## API Reference

### dataExplorer.js

```javascript
// Load CSV data
async loadData() → Promise<Array>

// Update selection count
updateSelectionCount() → void

// Send to training
gridApi.getSelectedRows() → Array<Object>
```

### training.js

```javascript
// Load training data
loadTrainingData() → Array<Object>

// Display data info
displayDataInfo() → void

// Start training (placeholder)
// Replace with TensorFlow.js code
```

### trainingIntegration.js (example)

```javascript
// Train model with selected data
trainModel(trainingData, config) → Promise<{model, history, xTest, yTest}>

// Update UI during training
updateTrainingProgress(epoch, totalEpochs, logs) → void
```

## Browser Compatibility

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

Requires:
- ES6 modules support
- sessionStorage API
- Fetch API
- CSS Grid
