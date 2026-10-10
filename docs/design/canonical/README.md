# Vleeds Canonical UI References

These files define the approved Vleeds visual direction.

## Canonical references

- vleeds-desktop-today.png
- vleeds-desktop-settings.png
- vleeds-mobile-today.png

These references are authoritative for:

- Vleeds application shell
- typography hierarchy
- navigation
- workspace selector
- color treatment
- cards
- borders
- shadows
- spacing
- buttons
- status pills
- desktop lead table
- lead detail drawer
- mobile bottom navigation

## Implementation rule

DO NOT REDESIGN.

Future screens should extend this visual language rather than introduce a new design system.

Older concepts belong in `docs/design/archive/` and must not override the canonical references.

## Reference hierarchy

Use this order of authority when implementing Vleeds UI:

1. `docs/design/canonical/` — approved visual specification
2. `docs/design/canonical/README.md` — implementation rules and reference notes
3. `docs/reports/screenshots/` — QA evidence only; these screenshots represent prior/current implementation states and are not design references

## Claude / implementation instruction

Before making any UI changes:

- Read `docs/design/canonical/README.md`
- Review all image references in `docs/design/canonical/`
- Treat those files as the authoritative visual specification
- Do not use screenshots under `docs/reports/` as design references
- Preserve the approved shell, spacing, typography, navigation, cards, colors, and interaction patterns
- Extend the design system consistently for new screens
- Do not reinterpret or redesign approved screens unless explicitly instructed
