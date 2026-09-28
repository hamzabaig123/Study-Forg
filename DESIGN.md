# Design Brief

## Direction

Forge & Ink — a scholarly study workstation where ember-warm accents meet deep indigo-ink neutrals, built for long focused sessions.

## Tone

Refined editorial meets modern tool: high-contrast serif display type, generous whitespace, and warm ember highlights that make progress feel earned rather than gamified.

## Differentiation

Every surface is a deliberate layer — the ember gradient marks progress and the timer, while the Green theme turns the whole workspace into pale botanical glass that stays as readable as light mode.

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
| ember-soft | 0.52 0.16 52 / 0.1   | Success panels, active section rail |

`.dark`: background `0.155 0.022 265`, foreground `0.94 0.012 85`, primary `0.76 0.16 62`, border `0.3 0.028 265`; code `0.135 0.02 265`.
`.frosted` — **"Green" (Meadow Glass)**: a light botanical glassmorphism treatment, the only theme whose CSS class and visible label differ (`frosted` is the persisted `user_settings.appearance` wire value; the UI never says "Frosted"). Pale mint canvas `0.958 0.024 152` lit by four soft leaf/olive radial washes and two drifting light orbs; foreground ink-green `0.31 0.052 154`; cards are translucent pale glass `0.994 0.012 150 / 0.78` over a white sheen edge (`--glass-border 1 0 0 / 0.68`) with a mint drop shadow; primary is deep olive `0.465 0.092 104` and accent is deep leaf `0.44 0.108 152`, both under a near-white foreground so `text-accent` links stay legible; the chart ramp is a lightness ladder rather than a hue wheel — olive `0.5 0.11 106` → mint `0.62 0.13 168` → pine `0.4 0.09 150` → olive-gold `0.56 0.12 78` → deep teal `0.3 0.06 176` — because `AccuracyChart` paints one bar per slot and every slot has to clear 3:1 against pale glass, which caps how light a series colour can be (oklch L ≈ 0.64); `--warning` sits at `0.53 0.125 86` for the same reason, as `text-warning` on glass or on its own tint. `dark:` variants do **not** apply here — `.frosted` was removed from the Tailwind `darkMode` selector when the theme turned light, so the 27 `dark:` refinements in the shadcn layer belong to `.dark` alone.

## Typography

- Display: Fraunces — headings, hero, class/subject titles (optical serif, scholarly weight)
- Body: General Sans — paragraphs, labels, forms, navigation
- Mono: Geist Mono — timer countdown, analytics figures, question counts (`.numeric`, tabular)
- Scale: hero `text-5xl md:text-7xl font-bold tracking-tight`, h2 `text-3xl md:text-4xl font-bold tracking-tight`, label `text-xs font-semibold tracking-widest uppercase`, body `text-base md:text-lg`

## Elevation & Depth

Light and dark use flat paper/ink surfaces with hairline borders and `shadow-subtle`; Green uses `surface-glass` (blur 18px + saturate 160%) with `shadow-glass` and a top highlight, so panels read as physical glass over a lit backdrop.

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
- Cards: `rounded-xl` (radius 0.75rem), `bg-card` + `border-border` + `shadow-subtle`; the Green theme swaps to `surface-glass`
- Badges: full-radius pills; `bg-primary/12 text-primary` for counts, `bg-accent/12 text-accent` for class/subject tags, `success`/`warning`/`destructive` for accuracy tiers
- Timer: large `.numeric` Geist Mono countdown on a glass or card panel
- QR well: `.qr-well` — white plate, `rounded-[calc(var(--radius)+2px)]`, exactly 4 modules of padding, `var(--glass-shadow)`; the code never sits on a themed surface
- Block editor: `.block-stack` rhythm (0.875rem between blocks), `.callout-rule` for callouts, `.surface-code` for formula blocks, `border-t` hairline for dividers
- Settings: `.save-bar` sticky bottom bar with blur + hairline top border; `.danger-zone` destructive-tinted panel; `.section-rail` marks the active nav row. Dialogs dim through shadcn's `[data-slot="dialog-overlay"]`, which the Green theme repaints as a muted pine wash
- Toasts: sonner, themed from the popover tokens, pinned bottom-right, `success`/`destructive` left rule by variant

## Surface Briefs

- Public QR generator: two-column — URL + options form on the left, sticky `.qr-well` preview card on the right; ember primary "Create link"; success state replaces the form with a `.contrast-ok` panel holding the short link and secret edit link in `.surface-code` chips with copy buttons
- Notes workspace: three-pane — searchable notes list (`.section-rail` active row), centered block editor with a block-type toolbar above the caret, autosave chip (Saving / Saved `success` / Failed `destructive` + retry), and a read-only preview toggle rendering identical blocks
- Settings: left section nav with `.section-rail`, right content column, `.save-bar` sticky at the bottom, `.danger-zone` destructive-tinted; destructive actions gated by a dimmed confirmation dialog requiring re-auth plus typed confirmation

## Motion

- Route arrival: `.page-enter` on the routed container — a 0.38s rise with a whisper of scale and a blur that snaps into focus, run on that one element only so no phone GPU pays for per-card blur
- Entrance: `fade-up` 0.5s cubic-bezier(0.16, 1, 0.3, 1); lists and card grids sit in a `.stagger` container so each direct child rises one beat after the last
- Hover: `transition-smooth` (0.3s) on background, border, and shadow — no bounce, no scale on text; `.card-interactive` lifts a settings tile, `.sheen-host` sweeps a specular highlight across a stat card on hover
- Emphasis: `.animate-rise-sm` when a session answer lands, `.score-ring-fg` drawing the result ring, `.draw-hairline` under a page title
- Decorative: `drift` on ambient gradient orbs in the landing hero
- Every one of these is switched off under `prefers-reduced-motion`, alongside `fade-up`, `fade-in` and `drift`

## Constraints

- All three themes (light, dark, Green) must keep body text ≥ 4.5:1 and headings ≥ 3:1 contrast — including on cards, forms, and the timer
- Green is a distinct glass treatment, never a tint of light: the meadow backdrop, translucent pale-glass panels, and blur are what separate it — its text stays dark-on-mint at the same contrast bar, and its `--primary` is olive rather than ember (ember stays the light/dark theme's action colour)
- Token-only styling: no raw hex, `rgb()`, or arbitrary color classes in components (the QR well's `#ffffff` is the one sanctioned exception — it is required for scannability)
- Ember is reserved for primary action, progress, and the timer — never used as a page background fill
- No spaced-repetition scheduling, shared workspaces, difficulty/adaptive tagging, or streak/goal tracking UI
- QR codes always render dark-on-light inside `.qr-well`; the contrast guardrail blocks low-contrast or inverted color pairs and the quiet zone is never cropped
- The Notes editor and its read-only preview render from the same stored block document — no divergent markup between the two modes

## Signature Detail

The ember progress meter: a thin gradient-filled rule (`bg-gradient-primary`) that underlines section headings and fills the timer ring, making study progress the app's single recurring visual motif.
