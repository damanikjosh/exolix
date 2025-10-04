# Refactoring Summary: Functional CSS Classes

## Overview
Refactored component-specific CSS classes into functional, reusable utility classes following a simpler, more maintainable approach.

## Changes Made

### ❌ Removed Component-Specific Classes
- `.column-chip` → `.draggable .bg-semi-light .bg-blur`
- `.value-chip` → `.draggable .bg-semi-light .bg-blur`
- `.feature-box` → `.drop-zone .border-dashed-gray .bg-semi-dark .bg-blur-sm`
- `.label-drop-zone` → (use `.drop-zone` with background utilities)
- `.tab-button` → (use Tailwind utilities + `.active-tab` for state)
- `.feature-mapped-header` → `.highlight-header`
- `.feature-mapped-cell` → `.highlight-cell`
- `.instruction-text` → (use `.bg-semi .bg-blur` with Tailwind padding/border)
- `.info-box` → (use `.bg-semi .bg-blur` with Tailwind padding/border)

### ✅ Added Functional Utility Classes

#### Background Utilities
```scss
.bg-semi         // Semi-transparent background (medium)
.bg-semi-dark    // Semi-transparent background (darker)
.bg-semi-light   // Semi-transparent background (lighter)
.bg-blur         // Backdrop blur 8px
.bg-blur-sm      // Backdrop blur 4px
```

#### Interactive Utilities
```scss
.draggable       // Grab cursor, transitions, active state
.drop-zone       // Drop zone container (min-height, transitions)
  .drag-over     // Modifier: active drag state
  .filled        // Modifier: filled state
```

#### Border Utilities
```scss
.border-dashed-gray      // 2px dashed #4b5563
.border-solid-accent     // 2px solid #6366f1
```

#### State Utilities
```scss
.active-tab              // Active tab styling
.highlight-header        // Highlighted table header
.highlight-cell          // Highlighted table cell
.highlight-border        // Left/right border highlight
```

## Usage Examples

### Before
```html
<div class="column-chip px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full border border-gray-300 hover:bg-gray-200 cursor-grab">
  Column Name
</div>
```

### After
```html
<div class="draggable bg-semi-light bg-blur px-3 py-1 text-gray-300 text-sm rounded-full border border-gray-700 hover:bg-gray-600">
  Column Name
</div>
```

### Before
```html
<div class="feature-box drop-zone p-4 rounded">
  <!-- content -->
</div>
```

### After
```html
<div class="drop-zone border-dashed-gray bg-semi-dark bg-blur-sm p-4 rounded">
  <!-- content -->
</div>
```

## Benefits

1. **Composability**: Mix and match utilities for different use cases
2. **Maintainability**: Single source of truth for each visual pattern
3. **Flexibility**: Easy to combine with Tailwind utilities
4. **Simplicity**: Clear, descriptive names that explain what they do
5. **Reusability**: Same classes work across different components
6. **Smaller CSS**: Less duplicate code

## Migration Guide

If you have custom code using old class names, update as follows:

| Old Class | New Approach |
|-----------|-------------|
| `.column-chip` | `.draggable .bg-semi-light .bg-blur` + spacing |
| `.feature-box` | `.drop-zone .border-dashed-gray .bg-semi-dark .bg-blur-sm` |
| `.tab-button.active` | `.active-tab` |
| `.feature-mapped-header` | `.highlight-header` |
| `.feature-mapped-cell` | `.highlight-cell` |

## Philosophy

**Keep It Simple**: 
- Use Tailwind for spacing, colors, typography
- Add custom classes only for patterns that:
  - Repeat frequently
  - Have complex interactions (like drag-and-drop)
  - Need specific visual effects (like blur)
  - Represent a clear functional pattern

**Functional Over Semantic**:
- `.draggable` (what it does) ✅
- `.column-chip` (what it is) ❌

**Composable Over Monolithic**:
- `.bg-semi .bg-blur` (combine as needed) ✅
- `.instruction-text` (single use case) ❌
