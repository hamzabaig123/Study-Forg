# StudyForge — UI/UX Design

*Version 1.0 · 2026-09-29. The design system as it ships. The measured token
tables (per-theme hex values, OKLCH coordinates and the gradient pairings) live
in the root `DESIGN.md`, which this document completes with flows, states,
accessibility and responsive behaviour.*

## 1. Direction — Forge & Ink

A scholarly study workstation: high-contrast serif display type over quiet
two-tone canvases, with one warm action colour doing the work. The pairing
changes per theme — burnt orange on vanilla, lime on graphite, emerald on mint,
forge-maroon on warm white — and the discipline does not. Progress is the
recurring motif: a thin gradient rule under section headings, the timer ring,
the score arc.

## 2. The four themes

| Theme (label) | Stored name | Canvas | Action | Character |
| --- | --- | --- | --- | --- |
| Light | `light` | Vanilla `#FFF6D4` | Burnt orange `#C74100` | warm paper, flat surfaces |
| Dark | `dark` | Graphite `#1A1F29` | Lime spark `#B7F652` | neutral ink, no indigo cast |
| Green | `frosted` | Mint glass `#E6F6E9` | Emerald ink `#064E3B` | translucent glass panels, champagne accents |
| Maroon Forge | `maroon` | Warm white `#FFF7F2` | Forge maroon `#4A111C` | deep actions, bright red `#C43D3D` reserved for reading, not pressing |

Rules that hold everywhere:

- Only `.dark` fires the 27 `dark:` refinements — the light-canvas themes never
  inherit them (proven in the built stylesheet).
- Measured floors per theme: body ≥ 11.9:1, muted ≥ 5.1:1, action text on its
  own fill ≥ 4.5:1, warning text ≥ 4.7:1, chart series ≥ 3:1 on card.
- Token-only styling in components; the QR well's white plate is the one
  sanctioned raw hex (scannability).
- Green is a treatment, not a tint: blur + saturate glass, sheen edges, and a
  dark emerald primary that stays legible on mint.

## 3. Typography and spacing

- **Fraunces** for display (hero, page titles, card titles) — scholarly serif.
- **General Sans** for body, labels, forms.
- **Geist Mono** (`.numeric`, tabular) for timers, scores and counts.
- Scale: hero 5xl→7xl tight; h2 3xl→4xl; labels `text-xs font-semibold
  tracking-widest uppercase`; body base→lg. Sections `py-16 md:py-24` inside
  `max-w-6xl`; cards `p-5 md:p-6`, radius `0.75rem`.

## 4. Motion (the system)

`LazyMotion strict` + `MotionConfig reducedMotion="user"` — everything animates
through the `m` proxy, the feature set is a lazy chunk (28 KB gzip), and
`motion.*` is a build error by contract test.

- **Routes** hand off: outgoing page lifts 6 px and fades (150 ms), the
  incoming one rises 8 px (340 ms, `AnimatePresence mode="wait"`).
- **Entrances**: `BlurFade` (rise + fade + focus pull; `blur={false}` for tall
  subtrees) and CSS `.stagger` beats for static grids.
- **Buttons**: named-property transitions, 1 px hover lift, 75 ms press sink —
  never `transition: all`, never scale.
- **Celebration**: at ≥ 75 % the score ring draws, the number counts up from
  zero (clamped, monotone, measured), and 28 CSS confetti pieces fall — all
  refused under `prefers-reduced-motion`.
- **Restraint**: one-shot `text-sweep` on the landing headline; the only
  infinite animation is the ambient orb drift. The footer credit draws its
  accent underline once.

## 5. States (all four themes, captured on camera)

- **Empty**: designed panels with the next action in place — dashboard
  "Nothing here yet", "No analytics yet", builder, notes, results.
- **Loading**: `LoadingState` fallbacks behind every lazy route, data
  skeletons, and the **boot shell** — a themed wordmark in `index.html` that
  paints before the bundle and is replaced by React on mount (slow-3G verified
  at 900 ms).
- **Error**: graceful not-found ("No results to show" + next actions), retry
  panels, a storage-health banner when local persistence fails, sonner toasts.

## 6. Accessibility (audited, not assumed)

- Two axe passes over live pages; every Critical/Major landed as code:
  combobox triggers named by paired `<label htmlFor>` + `id` (the placeholder
  is not a name), heading outline repaired (`CardTitle` renders `h2`-capable
  headings; no `h1 → h3` skips), amber-on-amber chips moved to measured
  `text-amber-800`, sidebar labels raised to `/70` (≥ 4.76:1 in all four
  themes).
- ~45 axe rows were **abstentions**, not failures — the card spotlight's idle
  `::after` now exists only under `:hover`, so the rule has nothing to reason
  about; verified in the built stylesheet.
- Keyboard: skip-to-content first, focus-visible rings, dialog focus management
  via Radix; reduced-motion honoured at both the provider and the stylesheet.

## 7. Responsive findings (measured, not predicted)

- A `grid` with no base column sizes its implicit track to min-content —
  unwrappable children (`whitespace-nowrap` labels) widen the page; mobile
  tracks get explicit `grid-cols-*`.
- shadcn's `SelectValue` clipping variants match nothing in this build — long
  labels are shortened instead (Radix mirrors children into the trigger).
- At 320 px the header drops the account text for an icon-only pill with an
  `sr-only` name.
- Sweeps: 259–1440 px overflow pass clean; **120 themed screenshots** at
  1440/390/320 with zero overflow and zero blanks; the 320 px pass is 32/32.

## 8. Component patterns (the vocabulary)

Ember/gradient primary buttons with press physics; `rounded-xl` cards with
hairline borders; full-radius badges for counts and tiers; the `.numeric`
mono timer; the white `.qr-well` plate with its 4-module quiet zone; the
three-pane notes workspace; settings with `.section-rail`, a sticky
`.save-bar` and a destructive `.danger-zone`; sonner toasts with a left rule;
`.contrast-ok` panels after link creation; skeleton + spinner loading; the
`EmptyState`/`ErrorState` pair promoted to `h2`.

## 9. Where the pixels are specified

`DESIGN.md` carries the per-theme token tables (every value is the hex the
running app paints, canvas-flattened), the gradient pairings, elevation rules,
structural zones and the constraint list (including the deliberate non-goals).
`tailwind.config.js` + `src/index.css` are the implementation; the audit
harness (`theme-audit.mjs`) is the referee.
