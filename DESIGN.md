# Design Brief

## Direction

Forge & Ink — a scholarly study workstation where ember-warm accents meet deep indigo-ink neutrals, built for long focused sessions.

## Tone

Refined editorial meets modern tool: high-contrast serif display type, generous whitespace, and warm ember highlights that make progress feel earned rather than gamified.

## Differentiation

Every surface is a deliberate layer — the ember gradient marks progress and the timer, while the frosted theme turns the whole workspace into lit glass that stays as readable as light mode.

## Color Palette

| Token      | OKLCH        | Role                                     |
| ---------- | ------------ | ---------------------------------------- |
| background | 0.985 0.008 85 | Light parchment canvas                 |
| foreground | 0.2 0.025 265  | Ink text on light                       |
| card       | 1.0 0.004 85   | Raised paper surface                    |
| primary    | 0.52 0.16 52   | Ember — CTAs, progress, timer           |
| accent     | 0.42 0.13 265  | Indigo-ink — links, secondary emphasis  |
| muted      | 0.945 0.012 80 | Quiet fills, section alternation        |
| code       | 0.955 0.01 265 | Formula blocks, mono chips, QR well     |
| scrim      | 0.2 0.025 265 / 0.42 | Modal and confirmation backdrops |
| ember-soft | 0.52 0.16 52 / 0.1   | Success panels, active section rail |

`.dark`: background `0.155 0.022 265`, foreground `0.94 0.012 85`, primary `0.76 0.16 62`, border `0.3 0.028 265`; code `0.135 0.02 265`, scrim `0.08 0.02 265 / 0.66`.
`.frosted` — "Aurora Glass": a dark cinematic glassmorphism treatment. Deep teal-black base `0.19 0.028 225` under an emerald aurora with slow drifting light orbs and a warm gold counter-glow; cards are translucent dark glass `0.26 0.028 220 / 0.55` with hairline `1 0 0 / 0.14` borders, a faint specular top edge, and a gentle hover lift; primary is rich emerald `0.75 0.14 168` with a gold-tipped gradient and an emerald hover bloom; dialogs float as heavily blurred glass (`blur(24px)`) over a deepened scrim; `dark:` variants apply under `.frosted` exactly as under `.dark`.

## Typography

- Display: Fraunces — headings, hero, class/subject titles (optical serif, scholarly weight)
- Body: General Sans — paragraphs, labels, forms, navigation
- Mono: Geist Mono — timer countdown, analytics figures, question counts (`.numeric`, tabular)
- Scale: hero `text-5xl md:text-7xl font-bold tracking-tight`, h2 `text-3xl md:text-4xl font-bold tracking-tight`, label `text-xs font-semibold tracking-widest uppercase`, body `text-base md:text-lg`

## Elevation & Depth

Light and dark use flat paper/ink surfaces with hairline borders and `shadow-subtle`; frosted uses `surface-glass` (blur 18px + saturate 160%) with `shadow-glass` and a top highlight, so panels read as physical glass over a lit backdrop.

## Structural Zones

| Zone    | Background          | Border              | Notes                                                     |
| ------- | ------------------- | ------------------- | --------------------------------------------------------- |
| Header  | `bg-card` / glass   | `border-b`          | Sticky; ember logo mark + theme switcher on the right      |
| Content | `bg-background`     | —                   | Alternating `bg-muted/30` bands separate major sections    |
| Sidebar | `bg-sidebar` / glass| `border-r`          | Class → subject → chapter tree; ember active rail          |
| Footer  | `bg-muted/40`       | `border-t`          | Compact, muted text; never bare on the canvas              |

## Spacing & Rhythm

Sections use `py-16 md:py-24` gaps with `max-w-6xl` content; cards group at `gap-4 md:gap-6`, internal card padding `p-5 md:p-6`, micro-spacing on a 4px scale with `space-y-1.5` for label/field pairs.

## Component Patterns

- Buttons: ember `bg-primary` with `rounded-lg` and `shadow-subtle`; hover raises to `shadow-elevated` and deepens the gradient; ghost and outline variants for secondary actions
- Cards: `rounded-xl` (radius 0.75rem), `bg-card` + `border-border` + `shadow-subtle`; frosted variant swaps to `surface-glass`
- Badges: full-radius pills; `bg-primary/12 text-primary` for counts, `bg-accent/12 text-accent` for class/subject tags, `success`/`warning`/`destructive` for accuracy tiers
- Timer: large `.numeric` Geist Mono countdown on a glass or card panel with an ember `pulse-ring` while running
- QR well: `.qr-well` — white plate, `rounded-[calc(var(--radius)+2px)]`, exactly 4 modules of padding, `shadow-qr-frame`; the code never sits on a themed surface
- Block editor: `.block-stack` rhythm (0.875rem between blocks), `.callout-rule` for callouts, `.surface-code` for formula blocks, `border-t` hairline for dividers
- Settings: `.save-bar` sticky bottom bar with blur + hairline top border; `.surface-scrim` dialog backdrop; `.danger-zone` destructive-tinted panel; `.section-rail` marks the active nav row
- Toasts: `bg-card` + `shadow-toast` + `animate-toast-in`, pinned bottom-right, `success`/`destructive` left rule by variant

## Surface Briefs

- Public QR generator: two-column — URL + options form on the left, sticky `.qr-well` preview card on the right; ember primary "Create link"; success state replaces the form with a `.contrast-ok` panel holding the short link and secret edit link in `.surface-code` chips with copy buttons
- Notes workspace: three-pane — searchable notes list (`.section-rail` active row), centered block editor with a block-type toolbar above the caret, autosave chip (Saving `animate-save-pulse` / Saved `success` / Failed `destructive` + retry), and a read-only preview toggle rendering identical blocks
- Settings: left section nav with `.section-rail`, right content column, `.save-bar` sticky at the bottom, `.danger-zone` destructive-tinted; destructive actions gated by `.surface-scrim` dialog requiring re-auth plus typed confirmation

## Motion

- Entrance: `fade-up` 0.5s cubic-bezier(0.16, 1, 0.3, 1), staggered ~60ms across stat cards
- Hover: `transition-smooth` (0.3s) on background, border, and shadow — no bounce, no scale on text
- Decorative: `drift` on ambient gradient orbs in the landing hero; `pulse-ring` on the active timer only
- New surfaces: `animate-toast-in` for toasts, `animate-scale-in` for dialogs, `animate-save-pulse` on the Saving chip, `fade-in` when the QR preview re-renders

## Constraints

- All three themes (light, dark, frosted) must keep body text ≥ 4.5:1 and headings ≥ 3:1 contrast — including on cards, forms, and the timer
- Frosted is a distinct glass treatment, never a tint of dark: the aurora backdrop, glass layering, and blur are what separate it — its text stays light-on-dark at the same contrast bar
- Token-only styling: no raw hex, `rgb()`, or arbitrary color classes in components (the QR well's `#ffffff` is the one sanctioned exception — it is required for scannability)
- Ember is reserved for primary action, progress, and the timer — never used as a page background fill
- No spaced-repetition scheduling, shared workspaces, difficulty/adaptive tagging, or streak/goal tracking UI
- QR codes always render dark-on-light inside `.qr-well`; the contrast guardrail blocks low-contrast or inverted color pairs and the quiet zone is never cropped
- The Notes editor and its read-only preview render from the same stored block document — no divergent markup between the two modes

## Signature Detail

The ember progress meter: a thin gradient-filled rule (`bg-gradient-primary`) that underlines section headings and fills the timer ring, making study progress the app's single recurring visual motif.
