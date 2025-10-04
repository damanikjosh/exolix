# ExoLiX - Quick Start Guide

## What Was Built

A complete 3-page web application for the 2025 NASA Space Apps Challenge:

### 1. Landing Page (`landing.html`)
- Modern hero section with gradient background
- Features overview (3 cards)
- About section
- Team placeholder
- Tailwind CSS styling

### 2. Data Explorer (`data.html` + `dataExplorer.js`)
- Full-page AG Grid table
- Loads NASA exoplanet CSV data
- Checkbox selection (individual + select all)
- Color-coded disposition status
- "Send to Training" button
- Pagination (25/50/100/200 rows)
- Filters and sorting on all columns

### 3. Training Interface (`training.html` + `training.js`)
- Receives selected data from Data Explorer
- Shows dataset statistics
- Training configuration form:
  - Epochs
  - Learning Rate
  - Batch Size
  - Validation Split
- Ready for TensorFlow.js integration
- Data accessible as JavaScript array

## How It Works

```
User Flow:
1. index.html → Redirects to landing.html
2. Click "Explore Data" → data.html
3. Select rows with checkboxes
4. Click "Send to Training" → training.html
5. Configure hyperparameters
6. Click "Start Training" → [Connect to TensorFlow.js]
```

## Data Flow

```javascript
// In dataExplorer.js
const selected = gridApi.getSelectedRows(); // Get selected rows
sessionStorage.setItem('trainingData', JSON.stringify(selected)); // Store

// In training.js
const trainingData = JSON.parse(sessionStorage.getItem('trainingData')); // Retrieve
// trainingData is now a JavaScript array ready for training
```

## Key Files

- `index.html` - Redirect to landing
- `landing.html` - Landing page
- `data.html` - Data explorer page
- `dataExplorer.js` - Data explorer logic
- `training.html` - Training page
- `training.js` - Training logic
- `data.js` - Original training utilities (kept intact)
- `train.html` - Original training UI (kept intact)

## Running the App

```bash
# Start server
npm run watch

# or
./serve.sh

# Visit: http://localhost:1236
```

## Integration Points

### To Connect Training System:

In `training.js`, replace the placeholder training code:

```javascript
document.getElementById('startTraining').addEventListener('click', async () => {
  const config = { epochs, learningRate, batchSize, validationSplit };
  
  // YOUR TENSORFLOW.JS CODE HERE
  // trainingData array is available
  // Use existing train.js functions:
  // - getData() - to process data
  // - splitData() - to split into train/test
  // - Build and train model
  
  console.log('Training Data:', trainingData);
  console.log('Config:', config);
});
```

## Code Style

✅ **Simple & Clean**
- No unnecessary abstractions
- Vanilla JavaScript (no React/Vue complexity)
- Tailwind CSS for consistent styling
- Minimal dependencies

✅ **Well Organized**
- Clear file names
- Separated concerns
- Reusable components
- Easy to understand

✅ **Production Ready**
- Responsive design
- Error handling
- Loading states
- User feedback

## What to Add Next

1. **Connect Training**:
   - Import TensorFlow.js in `training.js`
   - Use `trainingData` array
   - Show progress visualization

2. **Add Team Info**:
   - Update landing.html team section
   - Add photos/bios

3. **Enhance Features** (optional):
   - Data visualization charts
   - Model performance metrics
   - Export predictions
   - Save/load models

## Notes

- All original files (`train.html`, `data.js`, etc.) are preserved
- New system works alongside existing code
- CSV data parsing works with your existing dataset
- AG Grid Community (free) is used for data table
- Tailwind CSS loaded via CDN (no build step needed)

## Browser Console

Open browser console to see:
```javascript
// Check stored data
JSON.parse(sessionStorage.getItem('trainingData'))

// In training page, data is logged when you click "Start Training"
```

## Summary

✅ 3 pages created (landing, data explorer, training)
✅ Row selection with checkboxes (header checkbox for select all)
✅ Data passed as JavaScript array
✅ Clean, organized code
✅ Tailwind CSS for styling  
✅ Ready for TensorFlow.js integration
✅ Minimal, no clutter

**Server is running at: http://localhost:1236**
