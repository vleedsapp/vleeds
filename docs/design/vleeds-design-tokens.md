# Vleeds — Design Tokens

Source of truth: `src/app/globals.css` (`@theme`). Tailwind 4 turns each token into a utility (`bg-canvas`, `text-ink-muted`, `rounded-xl`, `shadow-card`, …). Components must use these tokens rather than raw hex values.

The tokens are derived from the canonical references in `docs/design/canonical/`.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#f8f7f4` | Application background, sidebar |
| `surface` | `#ffffff` | Cards, panels, top bar, drawer, sheets |
| `surface-muted` | `#fbfaf8` | Inset areas, row hover |
| `sunken` | `#f1efea` | Skeletons, neutral icon circles, avatar |
| `line` / `line-strong` | `#ebe8e2` / `#dcd8d0` | Dividers and card borders / control borders |
| `ink` | `#16191c` | Strong text: titles, values |
| `ink-muted` | `#545b62` | Secondary text: subtitles, body |
| `ink-subtle` | `#6f757c` | Muted text: labels, metadata. Darker than the reference grey so it meets WCAG AA (4.6:1 on white) |
| `brand` / `brand-hover` | `#1d5c45` / `#174b38` | Primary green: primary buttons, active icon, links, focus ring |
| `brand-strong` | `#154532` | Text/icons on a green tint |
| `brand-tint` / `brand-tint-strong` | `#e8f1ec` / `#d5e8dd` | Active nav, soft "Call" buttons, grade A/B, role pill |
| `warning` / `warning-tint` | `#a86211` / `#fdf2e2` | Callbacks, grade C, fit < 72 |
| `attention` / `attention-tint` | `#cc6430` / `#fcefe7` | "Not configured" pill (dot + tint) |
| `danger` / `danger-tint` | `#b23a31` / `#fcebe9` | Errors, "Not interested" |
| `info` / `info-tint` | `#2d5fc4` / `#eaf0fc` | Follow-ups icon, informational signals |
| `violet` / `violet-tint` | `#7448b8` / `#f2ecfb` | Secondary signal category |

## Shape and depth

| Token | Value | Use |
| --- | --- | --- |
| `radius-sm` | 6px | Chips, kbd |
| `radius-md` | 8px | Buttons, inputs |
| `radius-lg` | 10px | Nav items, menu items, search |
| `radius-xl` | 14px | Cards, panels |
| `radius-2xl` | 18px | Auth cards, drawers, bottom sheet, bottom nav |
| `shadow-card` | two-layer, ≤4% alpha | Cards and panels |
| `shadow-bar` | hairline + soft drop | Desktop top bar |
| `shadow-pop` | ≤18% alpha | Menus, popovers, sheets |
| `shadow-drawer` | leftward soft | Lead detail drawer |

## Typography (Inter)

| Role | Size / weight |
| --- | --- |
| Page title | 28px mobile, 34px desktop · bold · -0.025em |
| Page subtitle | 15 / 17px · regular · `ink-muted` |
| Card title | 18 / 20px · semibold |
| Empty-state title | 19 / 21px · semibold |
| Body / table primary | 14.5–15px |
| Labels, metadata | 13–14px · `ink-subtle` |
| Pills | 12–12.5px · medium |
| Summary values | 22px mobile, 30px desktop · bold |
| Nav | 15.5px desktop, 11.5–12.5px bottom nav |

## Spacing rhythm

Spacing uses a 4px base. Page gutters are 16px on mobile, 24px at `sm` and 28px on desktop. Gaps between sections are 20–24px. Card padding is 20–24px (32px on auth cards). Table cells are 12px vertical. Touch targets are at least 44px (bottom-nav items 56px).

## Icons

lucide-react only: stroke 1.6–1.75 by default, 2 for active mobile nav. Sizes are 16px inline, 18–22px in rows and navigation, and 24–28px in illustrations and headers.
