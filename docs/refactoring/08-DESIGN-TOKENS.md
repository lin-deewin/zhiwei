# V3 Design Tokens

The V3 UI uses a small semantic token layer before individual page styling. Existing legacy variables remain as compatibility aliases while page styles are migrated incrementally.

## Color

| Token | Purpose |
|---|---|
| `--color-canvas` | Application background |
| `--color-surface` | Primary card and panel surface |
| `--color-surface-subtle` | Quiet secondary surface |
| `--color-text-primary` | Main text |
| `--color-text-secondary` | Secondary text |
| `--color-border` | Default separator |
| `--color-accent` | Brand / active state |
| `--color-accent-strong` | High-emphasis brand action |
| `--color-accent-soft` | Selected navigation and soft emphasis |
| `--color-danger` | Destructive state |
| `--color-focus` | Keyboard focus ring color |

## Spacing

Use the `--space-1` through `--space-12` scale for layout rhythm. Prefer gaps and padding from this scale instead of introducing arbitrary values for new components.

## Shape and elevation

- `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl` define the shared corner scale.
- `--shadow-soft` is for restrained card elevation.
- `--shadow-popover` is for overlays and floating surfaces.

## Motion and reading layout

- `--motion-fast` and `--motion-base` are the standard transition durations.
- `--focus-ring` is the common visible keyboard focus treatment.
- `--reading-content-width` constrains long-form reading text.
- `--workspace-max-width` constrains wide workspaces.

## Migration rules

1. Keep old tokens (`--ink`, `--muted`, `--line`, `--green`, `--green-dark`, `--green-pale`, `--serif`) until all legacy selectors have migrated.
2. New UI components must use semantic tokens.
3. Do not create per-page color palettes for ordinary text, borders, or surfaces.
4. Do not add global CSS overrides at the end of the stylesheet to patch isolated components; place component styles near the owning component or in a clearly named section.
5. Preserve keyboard focus visibility and reduced-motion behavior.
