# Haloop design system

Extracted from [docs/mocks](../mocks/README.md) on 2026-11-23. Open [index.html](index.html) locally in any browser to inspect live tokens, light/dark themes, contrast ratios and every component state.

## Foundations

| Page | Covers |
|---|---|
| [Color](foundations/color.html) | Warm linen paper, deep ink, Halo gold, semantic roles, dark theme and verified WCAG 2.2 AA contrast. |
| [Typography](foundations/typography.html) | Outfit display, Inter UI and JetBrains Mono type scale, roles, weights, line heights and measure. |
| [Spacing](foundations/spacing.html) | 4px spacing scale from 0 to 96px, control heights, and inside-versus-between rhythm rules. |
| [Layout](foundations/layout.html) | Mobile-first 4/8/12-column grid, breakpoints, gutters, margins, container and Haloop AppShell templates. |
| [Elevation](foundations/elevation.html) | Four shadow levels, surface hierarchy across themes, and the nine-layer z-order stack. |
| [Shape](foundations/shape.html) | Five border radii plus pill/full, and hairline/thick border widths mapped by element size. |
| [Motion](foundations/motion.html) | Five durations, four easing curves, choreography rules and automatic reduced-motion handling. |
| [Iconography](foundations/iconography.html) | 24px stroke icon system, Haloop brand mark, sizing scale, labelling rules and harvested icon sheet. |
| [Theming](foundations/theming.html) | Light paper and dark ink themes, OS preference detection, high-contrast overrides and DTCG tokens.json. |
| [Responsive](foundations/responsive.html) | Mobile-first breakpoints, per-component adaptation rules, touch targets and testing matrix. |
| [Accessibility](foundations/accessibility.html) | WCAG 2.2 AA commitments across perceivable, operable, understandable and robust criteria. |
| [Content](foundations/content.html) | Voice and tone, sentence case, verb-first actions, error and empty-state formulas, and Haloop microcopy. |

## Components

| Component | Category | Summary |
|---|---|---|
| [Button](components/button.html) | Actions | Primary, secondary, ghost, link, danger, pill and icon-only actions in three sizes and all states. |
| [Link](components/link.html) | Actions | Inline, standalone with icon, and external navigation links with clear underline affordances. |
| [Menu](components/menu.html) | Actions | Dropdown action menus with icons, keyboard shortcuts, sections, danger items and checkable options. |
| [Text field](components/text-field.html) | Inputs | Text, e-mail, password, number and search inputs with addons, icons and character counters. |
| [Textarea](components/textarea.html) | Inputs | Multi-line text input for workout notes, reflections and Coach prompts. |
| [Select](components/select.html) | Inputs | Native dropdown selection for language, units, translation and AI backend preferences. |
| [Checkbox](components/checkbox.html) | Inputs | Single and grouped checkboxes with descriptions, indeterminate state and validation. |
| [Radio group](components/radio-group.html) | Inputs | Vertical, horizontal and card-style mutually exclusive choices in a fieldset. |
| [Switch](components/switch.html) | Inputs | Binary on/off toggle for live voice cues, camera guidance and on-device settings. |
| [Form field](components/form-field.html) | Inputs | Layout primitive pairing label, control, help text, character counter and error message. |
| [Form layout](components/form-layout.html) | Inputs | Single-column, two-column and inline form structure with error summary and actions bar. |
| [Top bar](components/topbar.html) | Navigation | Sticky Haloop app header and mobile bottom tab bar adapting across phone, tablet and desktop. |
| [Sidebar navigation](components/sidebar.html) | Navigation | Always-ink desktop rail with Haloop brand mark, route links and live AI/device status footer. |
| [Tabs](components/tabs.html) | Navigation | Horizontal underline tabs with counts and keyboard arrow navigation. |
| [Breadcrumb](components/breadcrumb.html) | Navigation | Hierarchical trail for detail views like History to Session detail. |
| [Pagination](components/pagination.html) | Navigation | Numbered and previous/next page navigation for workout history tables. |
| [Stepper](components/stepper.html) | Navigation | Multi-step progress indicator used in Welcome & setup onboarding. |
| [Skip link](components/skip-link.html) | Navigation | Keyboard-first bypass link jumping directly to the main landmark. |
| [Card](components/card.html) | Containers & overlays | Elevated paper surfaces, interactive cards, sunken wells and Haloop Scripture verse cards. |
| [Dialog](components/dialog.html) | Containers & overlays | Modal dialogs and mobile bottom sheets for confirmations, device pairing, workout completion and search. |
| [Tooltip](components/tooltip.html) | Containers & overlays | Inverse-surface hover and focus hints for icon-only buttons and keyboard shortcuts. |
| [Divider](components/divider.html) | Containers & overlays | Hairline horizontal and vertical rules separating sections and list items. |
| [Layout primitives](components/layout-primitives.html) | Containers & overlays | Container, grid, stack and cluster utilities driving consistent spacing and alignment. |
| [Table](components/table.html) | Data display | Responsive data tables with sticky headers, sorting, tabular numbers, selection and row actions. |
| [List](components/list.html) | Data display | Structured hairline lists including Haloop AI Lab model rows, built-in API grids and device lists. |
| [Description list](components/description-list.html) | Data display | Key-value pairs for session summaries, hardware telemetry and cached model metadata. |
| [Avatar](components/avatar.html) | Data display | Initials, image and icon avatars with group overlap and size variants. |
| [Badge & status](components/badge.html) | Data display | Tinted and solid status pills, count badges and live Haloop status dots. |
| [Chip](components/chip.html) | Data display | Filter toggle chips and removable tag chips for workout history and Scripture search. |
| [Stat / KPI](components/stat.html) | Data display | Tabular numeric KPI readouts with directional delta indicators for Today and History. |
| [Toast](components/toast.html) | Feedback | Transient inverse-surface notifications for model cache updates and Bluetooth device events. |
| [Alert & banner](components/alert.html) | Feedback | Inline contextual alerts and full-width system status banners in four semantic tones. |
| [Inline message](components/inline-message.html) | Feedback | Field hints, validation errors and compact inline status indicators. |
| [Progress bar](components/progress-bar.html) | Feedback | Determinate, indeterminate and AI Lab cache budget bars with semantic tones. |
| [Spinner](components/spinner.html) | Feedback | Compact and large circular loading indicators with accessible status text. |
| [Skeleton](components/skeleton.html) | Feedback | Shimmering placeholders for text, titles, circles and cards during initial load. |
| [Empty state](components/empty-state.html) | Feedback | First-run, filtered no-results and recoverable error placeholders with clear next actions. |
| [Error page](components/error-page.html) | Feedback | Full-page fallbacks for 404 Not Found, Offline mode and Unsupported browser states. |

## Patterns

| Pattern | Covers |
|---|---|
| [Forms](patterns/forms.html) | Layout, label placement, blur validation, error summaries, busy submits and destructive confirmations. |
| [Feedback & loading](patterns/feedback-and-loading.html) | Choosing between inline status, toasts, banners, skeletons, spinners and progress bars. |
| [Empty & error states](patterns/empty-and-error-states.html) | First-run, filtered zero-results, offline and unsupported-browser recovery patterns. |
| [Navigation & page structure](patterns/navigation-and-page-structure.html) | Haloop ink sidebar, sticky top bar, phone tabs, page headers and breadcrumbs. |
| [Dialogs & overlays](patterns/dialogs-and-overlays.html) | When to use modal dialogs, bottom sheets, menus and tooltips, plus stacking and focus return. |
| [Data tables & lists](patterns/data-tables-and-lists.html) | Hairline lists versus data tables, sorting, filtering, tabular numbers and mobile responsiveness. |
| [Notifications](patterns/notifications.html) | Toasts, persistent banners, stacking rules, auto-dismiss timing and live-region politeness. |
| [Content & tone](patterns/content-and-tone.html) | Haloop's calm, encouraging voice, sentence case, action verbs and reusable microcopy. |

## Tokens

- [tokens/tokens.css](tokens/tokens.css) — single source of truth (216 `:root` primitives & semantic tokens + dark, reduced-motion, high-contrast and forced-colors overrides).
- [tokens/tokens.json](tokens/tokens.json) — W3C DTCG export (278 tokens).
- [tokens/contrast-pairs.json](tokens/contrast-pairs.json) — 128 verified foreground/background contrast pairings across light and dark themes.
- [assets/components.css](assets/components.css) — token-driven component stylesheet with `:hover`/`:focus-visible`/`:active` and `data-state` hooks.

## Drift found in the mocks

| Mock / File | Issue | Resolution |
|---|---|---|
| `docs/mocks/assets/tokens.css` | Light-theme `--color-warning-icon` (`#b87a16`) on `--color-warning-bg` (`#f6e6c6`) measured 2.92:1 (< 3.0:1 WCAG 1.4.11). | Raised `--color-warning-icon` to `var(--palette-amber-700)` (`#855407`, 5.22:1). |
| `docs/mocks/assets/tokens.css` | Light-theme `--color-success-solid` (`#2f8a5b`) and `--color-warning-solid` (`#b87a16`) failed 4.5:1 with inverse badge text (3.83:1 and 3.22:1). | Darkened to `var(--palette-green-700)` (6.18:1) and `var(--palette-amber-700)` (5.75:1). |
| `docs/mocks/assets/ui.css` | Off-grid sizes: `.status-dot` (7px / `0.4375rem`), `.budget-bar` (6px / `0.375rem`), `.badge` min-height (22px / `1.375rem`), `.has-tooltip .tooltip` offset (`8px`), `.alert .icon` margin (`0.1rem`), `.tab::after` radius (`2px 2px 0 0`), `.btn-group` `z-index: 1`. | Snapped to 4px grid and tokens (`--space-2`, `--target-min`, `--space-0-5`, `--radius-xs`, `--z-raised`) in `assets/components.css`. |
| `docs/mocks/pages/ai-lab/*.html` (and 70 mock instances) | Inline `style="width:0.75rem;height:0.75rem;"` on external-link repo icons. | Added `.icon--xs` utility class (`0.75rem`) in `assets/components.css`. |

## Verification

- `python3 .agents/skills/extracting-design-systems/scripts/check_contrast.py docs/design-system/tokens/tokens.css` — **128 passed, 0 failed, 0 unresolved**
- `python3 .agents/skills/extracting-design-systems/scripts/tokens_to_json.py docs/design-system/tokens/tokens.css` — **278 tokens exported**
- `python3 .agents/skills/extracting-design-systems/scripts/check_design_system.py docs/design-system` — **59 pages (38 components, 8 patterns), 0 errors, 0 warnings**
- `python3 .agents/skills/writing-html-mocks/scripts/check_mocks.py docs/mocks` — **20 screens, 76 mocks, 0 errors, 0 warnings** (after pointing mocks at `../design-system/tokens/tokens.css` and `../design-system/assets/components.css`)
- Visual screenshots captured and reviewed at `360×800` and `1280×800` in light and dark themes.
