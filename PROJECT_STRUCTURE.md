# ExoLiX Project Structure

## 📁 Clean & Organized Structure

```
exoplanet-train/
├── 🌐 HTML Pages (User Interface)
│   ├── landing.html           # Landing page
│   ├── multiTableExplorer.html # Data explorer with AG Grid
│   ├── featureMapping.html    # Feature mapping interface
│   └── training.html          # Model training interface
│
├── 📜 JavaScript Modules
│   ├── shared.js              # Shared utilities & navigation
│   ├── starfield.js           # Starfield background animation
│   ├── multiTableExplorer.js  # Data explorer logic
│   ├── featureMapping.js      # Feature mapping logic
│   ├── training.js            # Training logic
│   ├── dataStore.js           # IndexedDB wrapper
│   └── datasetManager.js      # CSV parsing & data management
│
├── 🎨 Styles (SCSS)
│   ├── dark-theme.scss        # Dark theme with semantic classes
│   ├── style.scss             # Base styles
│   └── _material-components-web.scss # Material components
│
├── 📊 Static Assets
│   └── static/
│       └── cumulative_2025.09.29_21.37.15.csv # NASA Kepler data
│
├── 📚 Documentation
│   ├── README.md              # Project overview
│   ├── SEMANTIC_CLASSES.md    # Semantic CSS class guide
│   ├── STYLING.md             # Styling architecture
│   └── REFACTORING.md         # Migration guide
│
└── ⚙️ Configuration
    ├── package.json           # Dependencies & scripts
    ├── yarn.lock             # Dependency lock
    ├── .nvmrc                # Node version
    ├── .gitignore            # Git ignore rules
    └── serve.sh              # Development server script
```

## 🗑️ Cleaned Up (Deleted Files)

### Old Pages
- ❌ `index.html` + `index.js` - Replaced by `landing.html`
- ❌ `train.html` + `train.js` - Replaced by `training.html` + `training.js`
- ❌ `data.html` + `data.js` - Not used

### Old Scripts
- ❌ `dataExplorer.js` - Replaced by `multiTableExplorer.js`
- ❌ `trainingIntegration.js` - Duplicate
- ❌ `ui.js` - Old UI code
- ❌ `loader.js` - Old loader

### Unused Directories
- ❌ `components/` - Old nav component (now in shared.js)
- ❌ `styles/` - Old CSS (now using SCSS)

### Outdated Docs
- ❌ `PROJECT_README.md`
- ❌ `IMPLEMENTATION_COMPLETE.md`
- ❌ `IMPLEMENTATION_SUMMARY.md`
- ❌ `MULTI_TABLE_IMPLEMENTATION_SUMMARY.md`
- ❌ `MULTI_TABLE_FEATURE_MAPPING.md`
- ❌ `ARCHITECTURE.md`
- ❌ `QUICK_START.md`
- ❌ `INDEXEDDB_GUIDE.md`

## 🎯 Application Flow

```
Landing Page (landing.html)
    ↓
Data Explorer (multiTableExplorer.html)
    ├── Load CSV data
    ├── Select rows
    └── Send to Training
        ↓
Feature Mapping (featureMapping.html)
    ├── Map input features
    ├── Map output labels
    └── Configure label encoding
        ↓
Training (training.html)
    ├── Train TensorFlow.js model
    ├── View metrics & charts
    └── Save trained model
```

## 🔑 Key Technologies

- **Frontend**: Vanilla JavaScript (ES6+ modules)
- **Styling**: SASS/SCSS with semantic classes
- **Bundler**: Parcel 2.3.2
- **Data Grid**: AG Grid Community v34.2.0
- **ML**: TensorFlow.js v2.6.0
- **Storage**: IndexedDB v2
- **Charts**: @tensorflow/tfjs-vis v1.4.3

## 🚀 Development

```bash
# Install dependencies
yarn install

# Start dev server with hot reload
yarn watch

# Build for production
yarn build

# Or use the shell script
./serve.sh
```

## 📝 Notes

- All styles centralized in `scss/dark-theme.scss`
- Semantic CSS classes for easy theming
- Functional utility classes for reusability
- No duplicate code or unused files
- Clean, maintainable architecture
