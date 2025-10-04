# ExoLiX - Exoplanet Classification with AI

## 2025 NASA Space Apps Challenge
**Team: ExoLiX**

An intelligent web application for classifying Kepler Objects of Interest (KOIs) using machine learning. Built with TensorFlow.js, this system allows users to explore NASA's exoplanet data, select training datasets, and build custom AI models directly in the browser.

## Project Structure

```
exoplanet-train/
├── landing.html          # Landing page with project intro
├── data.html             # Data explorer with interactive table
├── dataExplorer.js       # Data explorer logic (AG Grid integration)
├── training.html         # Training interface
├── training.js           # Training page logic
├── train.html            # Original training system (legacy)
├── train.js              # TensorFlow.js training implementation
├── data.js               # Data processing utilities
├── loader.js             # CSV data loader
├── ui.js                 # UI utilities
├── static/               # CSV datasets
│   └── cumulative_2025.09.29_21.37.15.csv
└── scss/                 # Styles
    ├── style.scss
    └── _material-components-web.scss
```

## Features

### 1. **Landing Page** (`landing.html`)
- Project introduction
- Feature overview
- Team information section
- Clean, modern UI with Tailwind CSS

### 2. **Data Explorer** (`data.html` + `dataExplorer.js`)
- Interactive table powered by AG Grid
- Browse 9000+ Kepler Objects of Interest
- Advanced filtering and sorting
- Row selection with checkboxes
- Select all/individual data points
- Color-coded disposition status:
  - 🟢 CONFIRMED (green)
  - 🔴 FALSE POSITIVE (red)
  - 🟡 CANDIDATE (yellow)
- Send selected data to training system
- Pagination support (25, 50, 100, 200 rows per page)

### 3. **Training System** (`training.html` + `training.js`)
- Receives selected data from Data Explorer
- Displays dataset statistics
- Training configuration:
  - Epochs
  - Learning Rate
  - Batch Size
  - Validation Split
- Ready for TensorFlow.js integration
- Data stored in JavaScript arrays for easy access

## Data Flow

1. User selects rows in **Data Explorer**
2. Selected data → `sessionStorage` as JSON
3. Navigate to **Training** page
4. Training page reads data from `sessionStorage`
5. Data converted to JavaScript array
6. Ready for model training

## Installation

```bash
# Install dependencies
npm install

# or
yarn install
```

## Development

```bash
# Start development server
npm run watch

# or
./serve.sh
```

The app will be available at `http://localhost:1234`

## Build

```bash
# Build for production
npm run build
```

## Tech Stack

- **Frontend Framework**: Vanilla JavaScript (ES6+)
- **CSS Framework**: Tailwind CSS (CDN)
- **Data Grid**: AG Grid Community
- **ML Framework**: TensorFlow.js
- **Build Tool**: Parcel
- **CSV Parsing**: csv-parse

## Data Source

- **NASA Exoplanet Archive**
- Cumulative Kepler Objects of Interest dataset
- 9000+ observations
- 50+ features per observation

## Key Features

### Simple & Clean Code
- No unnecessary complexity
- Well-organized file structure
- Clear separation of concerns
- Minimal dependencies

### User-Friendly Interface
- Intuitive navigation
- Responsive design
- Visual feedback for selections
- Clear call-to-actions

### Flexible Training
- Select specific data points
- Or use entire dataset
- Configurable hyperparameters
- Real-time statistics

## Future Development

The training system (`training.html` + `training.js`) is ready to integrate with:

1. **TensorFlow.js Model Training**
   - Connect to existing `train.js` logic
   - Use selected data array
   - Display training progress

2. **Model Evaluation**
   - Accuracy metrics
   - Confusion matrix
   - Loss curves

3. **Prediction Interface**
   - Upload new data
   - Classify KOIs
   - Export results

## Team ExoLiX

[Team member information to be added]

Built for the 2025 NASA Space Apps Challenge

## License

Apache-2.0

## Acknowledgments

- NASA Exoplanet Archive for the dataset
- TensorFlow.js team
- AG Grid Community Edition
