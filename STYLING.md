# ExoLiX Styling Architecture

## Overview
All styling for ExoLiX has been centralized into SCSS files in the `scss/` directory for better maintainability and consistency across pages.

## Structure

```
scss/
├── _material-components-web.scss  # Material Design components
├── style.scss                      # Original TensorFlow.js example styles
└── dark-theme.scss                 # 🌟 NEW: Dark theme with space aesthetic
```

## Dark Theme Features

The `dark-theme.scss` file contains all the dark mode styling with:

### 🎨 CSS Variables
- Color palette (space blues, purples)
- Background gradients
- Accent colors
- Semi-transparent backgrounds

### 📦 Component Styles
- **Navigation**: Glassmorphism nav bar
- **Cards**: Semi-transparent cards with borders
- **Buttons**: Gradient buttons with hover effects
- **Forms**: Dark input fields with focus states
- **Links**: Blue links that get lighter on hover
- **AG Grid**: Dark theme for data tables

### ✨ Special Components
- **Feature Mapping**: Drag-and-drop styles, column chips, drop zones
- **Data Explorer**: Tab buttons, upload zones, empty states
- **Training**: Status messages, info boxes with blur effects

### 🌌 Starfield Background
- Canvas element positioned fixed
- Controlled by `starfield.js`

## Usage in HTML

```html
<head>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="scss/dark-theme.scss" />
</head>
```

## Common Classes

### Functional Utility Classes

#### Backgrounds
- `.bg-semi` - Semi-transparent background (medium opacity)
- `.bg-semi-dark` - Semi-transparent background (darker)
- `.bg-semi-light` - Semi-transparent background (lighter)
- `.bg-blur` - Backdrop blur effect (8px)
- `.bg-blur-sm` - Backdrop blur effect (4px)

#### Buttons
- `.btn-primary` - Primary gradient button
- `.bg-indigo-600` - Indigo button (same as primary)
- `.bg-green-600` - Green gradient button
- `.bg-red-600` - Red gradient button

#### Cards
- `.card` - Basic card with blur effect
- `.bg-white` - Same as card (for Tailwind compatibility)

#### Interactive Elements
- `.draggable` - Draggable element (grab cursor, transitions)
- `.drop-zone` - Drop zone container (min-height, transitions)
  - `.drop-zone.drag-over` - Active drag state
  - `.drop-zone.filled` - Filled state (solid border)

#### Borders
- `.border-dashed-gray` - Dashed gray border
- `.border-solid-accent` - Solid accent color border

#### States
- `.active-tab` - Active tab styling
- `.highlight-header` - Highlighted header (for tables)
- `.highlight-cell` - Highlighted cell (for tables)
- `.highlight-border` - Highlighted border (left/right)

## Customization

To customize the theme:

1. **Colors**: Edit CSS variables in `:root` section
2. **Component styles**: Find the relevant section in `dark-theme.scss`
3. **New components**: Add new sections following the existing structure

## Migration Notes

- ✅ All inline `<style>` tags removed from HTML files
- ✅ Styles consolidated into SCSS
- ✅ Consistent class names across all pages
- ✅ Better maintainability with SCSS nesting and variables
- ⚠️ `styles/dark-theme.css` is deprecated (use `scss/dark-theme.scss`)

## Build Process

Parcel automatically compiles SCSS files:
- Development: `npm run watch` or `./serve.sh`
- Production: `npm run build`

The `@parcel/transformer-sass` package handles SCSS compilation.
