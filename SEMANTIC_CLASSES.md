# Semantic CSS Classes Guide

This document lists all semantic CSS classes available for theming. These classes replace direct Tailwind utilities to make the codebase more themeable and maintainable.

## Status & Alerts

### Status Messages
- `.status-info` - Info status (blue, semibold)
- `.status-success` - Success container with border
  - `.status-title` - Success title (green-800)
  - `.status-message` - Success message text
- `.status-error` - Error container with border
  - `.status-title` - Error title (red-800)
  - `.status-message` - Error message text
- `.status-warning` - Warning container with border
  - `.status-title` - Warning title (orange-800)
  - `.status-message` - Warning message text

### Badges
- `.label-encoding-badge` - Label encoding info badge
  - `.badge-title` - Badge title
  - `.badge-content` - Badge content
  - `.badge-note` - Small note text

## Progress & Metrics

### Progress Indicators
- `.progress-container` - Container for progress bar
  - `.progress-header` - Header with label and info
    - `.progress-label` - Progress label
    - `.progress-info` - Progress info text
  - `.progress-bar-track` - Progress bar background
  - `.progress-bar-fill` - Progress bar fill (set width inline)

### Metric Cards
- `.metric-card` - Base metric card
  - `.metric-label` - Metric label text
  - `.metric-value` - Metric value (large, semibold)
- `.metric-train-loss` - Blue variant for training loss
- `.metric-train-acc` - Green variant for training accuracy
- `.metric-val-loss` - Orange variant for validation loss
- `.metric-val-acc` - Purple variant for validation accuracy

## Data Display

### Data Summary
- `.data-summary` - Data summary container
  - `.section-title` - Section title
  - `.section-content` - Section content text
  - `.section-list` - Bullet list for section content

### Empty States
- `.empty-state` - Empty state container (orange text)
  - `.empty-instructions` - Instructions text
  - `.empty-error` - Error message

## Feature Mapping

- `.drop-zone-empty` - Empty drop zone text
- `.mapped-value-chip` - Mapped value chip
- `.helper-text` - Helper text (gray-500, sm)
- `.helper-text-sm` - Smaller helper text (gray-400, xs)

## Charts

- `.chart-container` - Chart container
  - `.chart-title` - Chart title

## Layout

- `.grid-cols-2` - 2-column grid with gap
- `.grid-cols-4` - 4-column grid with gap
- `.action-buttons` - Action buttons container (flex with gap)

## Typography

### Headings
- `.heading-1` - H1 (3rem, bold, white)
- `.heading-2` - H2 (2.25rem, bold, white)
- `.heading-3` - H3 (1.875rem, bold, white)
- `.heading-4` - H4 (1.5rem, semibold, white)
- `.heading-5` - H5 (1.25rem, semibold, white)
- `.heading-6` - H6 (1.125rem, medium, white)

### Body Text
- `.text-body` - Standard body text (gray-300)
- `.text-body-lg` - Large body text (1.125rem, gray-300)
- `.text-muted` - Muted text (gray-400)
- `.text-subtle` - Subtle text (gray-500)
- `.text-label` - Label text (sm, medium, gray-300)
- `.text-small` - Small text (sm, gray-300)
- `.text-xs` - Extra small text (xs, gray-400)

## Forms

- `.form-input` - Standard form input
- `.form-select` - Standard form select dropdown

## Buttons

- `.btn` - Base button class
- `.btn-primary` - Primary button (indigo)
- `.btn-success` - Success button (green)
- `.btn-secondary` - Secondary button (gray)
- `.btn-ghost` - Ghost button (transparent, gray text)
- `.tab-button` - Tab button style

## Icons & Badges

- `.icon-upload` - Upload icon styling
- `.counter-badge` - Counter badge (sm, gray-400)

## Links

- `.link-primary` - Primary link (indigo, underline on hover)

## Usage Examples

### Status Messages
```html
<!-- Info status -->
<p class="status-info">Processing data...</p>

<!-- Success alert -->
<div class="status-success">
  <p class="status-title">Success!</p>
  <p class="status-message">Operation completed.</p>
</div>
```

### Progress Bar
```html
<div class="progress-container">
  <div class="progress-header">
    <span class="progress-label">Training Progress</span>
    <span class="progress-info">75%</span>
  </div>
  <div class="progress-bar-track">
    <div class="progress-bar-fill" style="width: 75%"></div>
  </div>
</div>
```

### Metric Cards
```html
<div class="grid-cols-4">
  <div class="metric-card metric-train-loss">
    <p class="metric-label">Training Loss</p>
    <p class="metric-value">0.1234</p>
  </div>
  <!-- More cards... -->
</div>
```

### Typography
```html
<h1 class="heading-1">Main Title</h1>
<h2 class="heading-2">Subtitle</h2>
<p class="text-body">This is body text.</p>
<p class="text-muted">This is muted text.</p>
```

### Buttons
```html
<button class="btn-primary">Start Training</button>
<button class="btn-success">Save Model</button>
<button class="btn-ghost">Cancel</button>
```

### Forms
```html
<label class="text-label">Email Address</label>
<input type="email" class="form-input" placeholder="Enter email">

<label class="text-label">Country</label>
<select class="form-select">
  <option>Select...</option>
</select>
```

## Theming

All colors in these classes are defined as RGB values in `dark-theme.scss`. To change the theme:

1. Update color values in the semantic class definitions
2. Modify CSS variables at the top of `dark-theme.scss`
3. No need to search through HTML/JS files

## Migration from Tailwind

Replace direct Tailwind classes with semantic equivalents:

| Tailwind | Semantic |
|----------|----------|
| `text-white` | `.heading-*` or `.text-body` |
| `text-gray-300` | `.text-body` |
| `text-gray-400` | `.text-muted` |
| `text-gray-500` | `.text-subtle` |
| `text-gray-600` | `.text-label` (for labels) |
| `text-indigo-700 font-semibold` | `.status-info` |
| `bg-green-50 border border-green-200 rounded p-4` | `.status-success` |
| `bg-red-50 border border-red-200 rounded p-4` | `.status-error` |
| Custom progress bars | `.progress-container` structure |
| Stat cards with colors | `.metric-card` with variant |
| `text-sm text-gray-500` | `.helper-text` |
| `text-xs text-gray-400` | `.helper-text-sm` |

## Benefits

✅ **Single Source of Truth**: Change theme colors in one place  
✅ **Semantic Meaning**: Class names describe purpose, not appearance  
✅ **Maintainability**: Easier to update styles consistently  
✅ **Type Safety**: Can be extended with TypeScript definitions  
✅ **Theming**: Easy to create light/dark/custom themes
