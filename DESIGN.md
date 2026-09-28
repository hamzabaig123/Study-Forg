# Design Brief

## Direction

Forge & Ink — a scholarly study workstation where a warm action colour meets a
quiet two-tone canvas, built for long focused sessions. The pairing changes per
theme (burnt orange on vanilla, lime on graphite, emerald on mint, forge-maroon
on warm white); the discipline does not.

## Tone

Refined editorial meets modern tool: high-contrast serif display type, generous whitespace, and warm ember highlights that make progress feel earned rather than gamified.

## Differentiation

Every surface is a deliberate layer — the theme's gradient marks progress and the timer, the Green theme turns the whole workspace into pale botanical glass that stays as readable as light mode, and Maroon Forge is that same discipline at a higher temperature: warm-white canvas, deep forge actions, a bright red reserved for the things you read rather than the things you press.

## Color Palette

Four themes, each a two-tone pairing: one light-canvas surface, one deep action
colour, and a bright signal colour reserved for links, timers and the accuracy
number. Every value below is the hex the token actually paints, read off the
running app (canvas-flattened, alpha composited over its real backdrop) rather
than remembered.

`.dark` is the only dark canvas, so it is the only theme whose `dark:` variants fire.

| Token | Light — Vanilla & Burnt Orange | Dark — Graphite & Lime | Green — Emerald Ink & Champagne | Maroon Forge |
| ----- | ------------------------------ | ---------------------- | ------------------------------- | ------------ |
| background | `#FFF6D4` (`0.972 0.045 93`) | `#1A1F29` (`0.24 0.02 262`) | `#E6F6E9` (`0.958 0.024 152`) | `#FFF7F2` (`0.9809 0.0109 54.4`) |
| card | `#FFFEF3` | `#232934` | `#F4FDF5` glass `0.994 0.012 150 / 0.78` | `#FFFCFB` |
| foreground | `#432610` | `#EAECE4` | `#0B3627` | `#3B1C1D` |
| primary (action) | `#C74100` (`0.56 0.185 43`) | `#B7F652` (`0.9 0.2 128`) | `#064E3B` (`0.378 0.073 168.9`) | `#4A111C` (`0.2796 0.0857 13.5`) |
| accent (links, emphasis) | `#C23600` (`0.54 0.19 42`) | `#AADF5B` | `#057558` | `#C43D3D` (`0.5568 0.1718 24.7`) |
| border | `#ECDCBD` | `#373D49` | `#B4CEB8 / 0.62` | `#D9AAA5` (`0.7794 0.056 25.4`) |
| warning | `#8C6500` (`0.53 0.125 86`) | `#E7B643` | `#8C6500` (`0.53 0.125 86`) | `#955F00` (`0.53 0.125 75`) |
| gradient-primary | `#DC5500 → #BB2F00` | `#B7F652 → #68D36F` | `#057558 → #064E3B` | `#791F2D → #4A111C` |

Measured floors, all four themes: body text ≥ 11.9:1, muted text ≥ 5.1:1, action
text on its own fill ≥ 4.5:1, `text-warning` ≥ 4.7:1, and every `--chart-*`
series ≥ 3:1 against its card. Green is the glass treatment — translucent pale
panels over the meadow wash, blur on cards and dialogs, a white sheen edge — and
the only theme whose CSS class (`frosted`, the persisted `user_settings.appearance`
value) differs from the label a user sees ("Green"). Maroon Forge dims its
dialogs to `#2A1015` (`--scrim`) instead of generic black, the one place that
deep surface paints.

`dark:` variants do **not** apply under `.frosted` or `.maroon` — `darkMode` lists
`.dark` alone, so the 27 `dark:` refinements in the shadcn layer belong to `.dark`
only. Green's chart ramp is a lightness ladder rather than a hue wheel because
`AccuracyChart` colours bars by palette slot and neighbours are compared side by
side; champagne stays in `--secondary`, `--gradient-subtle` and `--spotlight`,
never in `--gradient-primary`, which is clipped to headline text and would read
1.2:1 on the mint canvas.

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

Runtime: `LazyMotion features={domMax} strict` + `MotionConfig reducedMotion="user"` (`components/motion/provider.tsx`), so the whole app animates through the `m` proxy and `motion.*` is never imported — `motionSurface.contract.test.ts` fails the build on a stray import. `domMax` lives in `components/motion/features.ts` so it stays in its own lazy chunk and first paint never fetches it.

- Route arrival: `AnimatePresence mode="wait"` around the routed body in `AppLayout` and `PublicLayout`, keyed on `pathname` — the outgoing page lifts 6px and fades in 0.15s, then the incoming one rises 8px over 0.34s. It is React, not a CSS class, because a class on the container cannot see the previous page.
- Entrance: `BlurFade` (`m.div`: opacity, a 14px rise and a 6px blur that snaps to 0, 0.5s `cubic-bezier(0.16, 1, 0.3, 1)`) for anything that appears when its screen is first painted — landing sections, the result summary, the review list that mounts after its query resolves. Static card grids use the CSS `.stagger` container instead so each direct child rises one beat after the last; its fill mode is `backwards`, deliberately, because `both` would keep winning the cascade against a child's own hover transform forever.
- Text: `.text-sweep` wipes the landing headline's accent clause in through `clip-path` once (one-shot on purpose — an infinite shimmer on words the reader is trying to read is a distraction, not a treatment). Figures count instead of snapping: `NumberTicker` tweens on `requestAnimationFrame` with easeOutQuart, starting from whatever it already displays so a dashboard that refetches counts from the previous reading rather than from zero.
- Buttons: the base variant transitions `background-color, border-color, color, box-shadow, transform, filter` over 200ms ease-out, lifts 1px on hover with `shadow-sm`, and presses 1px back down at 75ms. No scale — a scaled text node rasterises blurry mid-transition, and `transition-all` dragged in every unrelated property.
- Emphasis: `.animate-rise-sm` when a session answer lands, `.score-ring-fg` drawing the result ring, `.draw-hairline` under a page title, `.sheen-host` sweeping a specular highlight across a stat card on hover, `.card-interactive` lifting a settings tile.
- Celebration: `ConfettiBurst` puts 28 CSS-only pieces (`confetti-fall`, deterministic per-index scatter, `aria-hidden`, self-unmounting at 3.2s) behind a score at or above 75% — the same threshold where `scoreMessage` starts saying "strong work", so the paper and the words celebrate the same result or neither does. No dependency was added for it.
- The footer credit's name carries a gradient hairline (`.credit-name::after`) that draws in once and then pans slowly; the gradient lives in the rule rather than in the 12px text because a brand gradient clipped to type that small measures below AA on every one of these palettes.
- Decorative: `drift` on the ambient gradient orbs behind the landing hero, and nothing else — motion that never stops is the one thing a reader cannot opt out of by looking away.
- Reduced motion is honoured twice over: the provider refuses transforms at the source, and the CSS block switches off `.stagger > *`, `.animate-rise-sm`, `.animate-drift`, `.text-sweep` and `.credit-name::after`, with `.confetti-piece` set to `display: none` — `animation: none` there would leave 28 static dots parked over the content. The test environment skips the confetti entirely.

## Constraints

- All four themes (light, dark, Green, Maroon Forge) must keep body text ≥ 4.5:1 and headings ≥ 3:1 contrast — including on cards, forms, and the timer. That floor is re-measured per token pass, not assumed: a theme is only "done" when every pair in `theme-audit.mjs` clears its bar on the running app
- Green is a distinct glass treatment, never a tint of light: the meadow backdrop, translucent pale-glass panels, and blur are what separate it — its text stays dark-on-mint at the same contrast bar, and its `--primary` is deep emerald `#064E3B` rather than the light theme's burnt orange
- Token-only styling: no raw hex, `rgb()`, or arbitrary color classes in components (the QR well's `#ffffff` is the one sanctioned exception — it is required for scannability)
- Each theme's action colour is reserved for primary action, progress, and the timer — never used as a page background fill. Maroon Forge additionally reserves `#C43D3D` for links and the timer, keeping `#4A111C` for actions
- No spaced-repetition scheduling, shared workspaces, difficulty/adaptive tagging, or streak/goal tracking UI
- QR codes always render dark-on-light inside `.qr-well`; the contrast guardrail blocks low-contrast or inverted color pairs and the quiet zone is never cropped
- The Notes editor and its read-only preview render from the same stored block document — no divergent markup between the two modes

## Signature Detail

The ember progress meter: a thin gradient-filled rule (`bg-gradient-primary`) that underlines section headings and fills the timer ring, making study progress the app's single recurring visual motif.
