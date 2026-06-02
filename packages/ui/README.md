# @ruletka/ui — "Midnight Aurora" Design System

The visual identity of **ruletka.top**. A token-driven, Radix-based, CVA-variant
React component library with a confident, nocturnal aesthetic built for a
premium video/voice roulette platform.

> **Aesthetic in one line:** deep ink-blue near-black canvas, frosted-glass
> surfaces, and a signature **electric-violet → cyan aurora** that headlines
> every CTA, the coin economy, and the Top feed.

---

## Table of contents

- [Design philosophy](#design-philosophy)
- [Palette](#palette)
- [Design tokens](#design-tokens)
- [Theming & dark mode](#theming--dark-mode)
- [Wiring it into an app](#wiring-it-into-an-app)
- [Typography](#typography)
- [Components](#components)
- [Signature pieces](#signature-pieces)
- [Accessibility](#accessibility)
- [Motion](#motion)

---

## Design philosophy

The product is where strangers meet on camera, often at night. The system leans
into that: **dark-first**, atmospheric, and tactile. Surfaces are frosted glass
floating over an aurora-tinted void. The accent is not a timid, evenly-spread
pastel — it is one **dominant gradient** used with intent. Everything else stays
calm and neutral so the aurora pops.

Three rules the system commits to:

1. **One signature gradient.** Violet `#7C5CFF` → cyan `#22D3EE`. It is the
   brand. Use it for the primary action, the active state, focus glows, and the
   coin/Top moments — and nowhere it would become noise.
2. **Glass over a living background.** Containers are translucent and blurred;
   pages carry a soft `bg-aurora-radial` glow plus optional `grain` so large
   gradients never band.
3. **Restraint elsewhere.** Neutrals are cool ink-blues, not pure grey. Text,
   borders, and secondary surfaces stay quiet.

---

## Palette

All colors are authored in **OKLCH** for perceptual uniformity and wide-gamut
richness, and tuned for **WCAG AA** against their intended surfaces.

### Dark (default)

| Token                  | Role                                  | Value (approx)        |
| ---------------------- | ------------------------------------- | --------------------- |
| `--background`         | App canvas                            | very dark ink-blue    |
| `--background-base`    | Deepest layer (behind canvas)         | near-black ink        |
| `--background-elevated`| Raised solid panels                   | dark slate-blue       |
| `--background-overlay` | Floating menus / popovers             | lighter slate-blue    |
| `--glass`              | Frosted surface fill (translucent)    | slate-blue @ 55%      |
| `--glass-border`       | Hairline on glass                     | white @ 8%            |
| `--foreground`         | Primary text                          | near-white            |
| `--muted-foreground`   | Secondary text                        | cool grey-blue        |
| `--subtle-foreground`  | Tertiary text / placeholders          | dim grey-blue         |
| **`--accent`**         | **Signature violet anchor**           | **electric violet**   |
| `--accent-from/via/to` | Aurora gradient stops (violet→cyan)   | violet · blue · cyan  |
| `--primary`            | Default CTA (maps to accent)          | electric violet       |
| `--secondary`          | Low-emphasis surface                  | muted slate           |
| `--success`            | Positive                              | mint green            |
| `--warning`            | Caution                               | amber                 |
| `--danger`             | Destructive / errors                  | warm red              |
| `--info`               | Informational                         | sky blue              |
| `--coin`               | Coin economy                          | warm gold             |
| `--rarity-*`           | Gift tiers (common→legendary)         | grey · blue · violet · gold |
| `--ring`               | Focus ring                            | bright violet         |

A `.light` theme provides the same token set re-tuned for light backgrounds.

---

## Design tokens

Tokens live in [`src/styles/tokens.css`](./src/styles/tokens.css) as CSS custom
properties and are mapped to Tailwind v4 utilities in
[`src/styles/theme.css`](./src/styles/theme.css) via `@theme inline`.

### Scales

- **Radii** — `--radius-xs … --radius-2xl`, `--radius-full` → `rounded-*`.
- **Shadows** — `--shadow-xs … --shadow-xl`, plus the signature
  `--shadow-glass`, `--shadow-glow`, `--shadow-glow-strong`, `--shadow-coin`
  → `shadow-*`.
- **Spacing** — `--spacing` base (0.25rem) drives all `p-*`, `m-*`, `gap-*`.
- **Fonts** — `--font-display`, `--font-sans`, `--font-mono` → `font-*`.
- **Motion** — `--duration-fast|base|slow` and `--ease-out-quart|out-back|in-out-soft`.
- **Z-index** — `--z-sticky|overlay|modal|toast|tooltip`.

Because the mapping uses **`@theme inline`**, utilities like `bg-background` and
`text-foreground` reference the live custom properties, so they react to a theme
class toggle at runtime instead of being frozen at build time.

### Tailwind utilities you get

`bg-background`, `bg-background-elevated`, `bg-glass`, `text-foreground`,
`text-muted-foreground`, `bg-accent`, `text-accent`, `border-border`,
`ring-ring`, `bg-primary`, `bg-secondary`, `bg-success|warning|danger|info`,
`text-coin`, `text-rarity-legendary`, `shadow-glow`, `rounded-xl`, `font-display`,
and so on — every token namespace listed above.

### Signature `@utility` classes ([`utilities.css`](./src/styles/utilities.css))

| Class               | Effect                                                        |
| ------------------- | ------------------------------------------------------------- |
| `glass` / `glass-strong` | Frosted translucent surface + blur + hairline + shadow   |
| `bg-aurora`         | The violet→cyan gradient as a background                      |
| `text-aurora`       | The gradient clipped to text (wordmark, headlines)            |
| `border-aurora`     | A 1px gradient border via mask compositing                    |
| `bg-aurora-radial`  | Full-bleed atmospheric aurora glow for page backgrounds       |
| `grain`             | Subtle noise overlay to kill gradient banding                 |
| `mask-fade-x`       | Fade left/right edges (used by `Marquee`)                     |

---

## Theming & dark mode

Dark is the **default** (`:root` is dark), so SSR and first paint are dark with
**no flash**. Opt into light by adding `.light` to a parent (usually `<html>`):

```html
<html class="light">…</html>
```

Dark mode uses the **class strategy** (not `prefers-color-scheme`). The `dark:`
and `light:` variants are wired in `theme.css`:

```css
@custom-variant dark (&:where(.dark, .dark *));
@custom-variant light (&:where(.light, .light *));
```

With **next-themes**, configure it to toggle the class and avoid FOUC:

```tsx
import { ThemeProvider } from 'next-themes';

<ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
  {children}
</ThemeProvider>;
```

> No FOUC: keep `<html>` dark by default (no class needed) and let next-themes
> add `.light` after hydration. Because the default theme is already dark, there
> is no flash of a light theme on load.

---

## Wiring it into an app

**1. Import the styles once** in your root stylesheet:

```css
@import '@ruletka/ui/styles/globals.css';

/* Let Tailwind scan the UI package so its classes aren't purged. */
@source '../../node_modules/@ruletka/ui/src';
```

`globals.css` pulls in Tailwind v4, the tokens, the theme mapping, and the
signature utilities in the correct order. (You can also import the four files
individually: `tokens.css`, `theme.css`, `utilities.css`.)

**2. Wire the fonts** (optional but recommended). The tokens ship with sensible
fallback stacks; to use the intended faces, expose them as the CSS variables.
With `next/font`:

```tsx
import localFont from 'next/font/local';
// or next/font/google for the body face

// Assign the loaded font CSS variables to our token names on <html>/<body>:
<body style={{
  '--font-display': 'var(--font-clash-display)',
  '--font-sans': 'var(--font-geist)',
}}>
```

**3. Use the components:**

```tsx
import { Button, GlassCard, CoinBalance, Toaster, toast } from '@ruletka/ui';

export function Example() {
  return (
    <GlassCard>
      <CoinBalance amount={12500} />
      <Button onClick={() => toast.success('Gift sent!')}>Send gift</Button>
    </GlassCard>
  );
}
```

Mount `<Toaster />` once near the app root.

---

## Typography

- **Display:** Clash Display (with Cabinet Grotesk / Space Grotesk fallbacks) —
  a characterful geometric grotesque for headlines and the wordmark.
- **Body:** Geist (with Satoshi / system fallbacks) — clean, modern, highly
  legible at UI sizes.
- **Mono:** Geist Mono — for codes, IDs, and tabular figures.

`h1`–`h4` default to the display face with tightened tracking. Use `font-display`
to opt other elements in.

---

## Components

All components are typed, forward refs where sensible, accept `className`
(merged via `cn`), and theme from the tokens.

| Component        | Notes                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| `Button`         | CVA variants `primary` (aurora) / `secondary` / `outline` / `ghost` / `glass` / `danger` / `link`; `loading`, `asChild`, icon slots. |
| `IconButton`     | Square/circular icon-only button; **requires `aria-label`**.          |
| `Card` / `GlassCard` | `glass` / `solid` / `outline` / `aurora` variants + `interactive`; with `CardHeader/Title/Description/Content/Footer`. |
| `Input`          | Wrapper-based field with leading/trailing icon slots and `invalid`.   |
| `Textarea`       | Matches `Input`; vertical resize.                                     |
| `Label`          | `required` asterisk with accessible hint.                             |
| `Badge`          | Semantic + `accent`/`aurora`/`coin` + four `rarity` tiers; `dot`.     |
| `Skeleton`       | Brand-tinted shimmer; `line`/`block`/`circle`.                        |
| `Spinner`        | CSS-only; reduced-motion aware.                                       |
| `Dialog` (`Modal`) | Radix dialog; focus trap, scroll lock, `Esc`; spring-in motion.     |
| `DropdownMenu`   | Radix menu; full keyboard nav; checkbox/radio/sub-menu items.         |
| `Tabs`           | Radix tabs; `pill` (aurora) or `underline` looks.                     |
| `Switch`         | Radix switch; aurora ON state with a spring thumb.                    |
| `Slider`         | Radix slider; **two-thumb range capable** (age filter), value bubbles.|
| `Tooltip`        | Radix tooltip; glass surface + arrow.                                 |
| `Avatar` / `AvatarGroup` | Radix avatar; image fallback to initials, presence dot, accent/aurora ring. |

---

## Signature pieces

### `Marquee` — the Top feed

Horizontal, infinitely-scrolling row that loops seamlessly (content is
duplicated and translated exactly 50%). Supports **both directions**, optional
**pause-on-hover**, and edge fade.

```tsx
<Marquee direction="left" speed={50} pauseOnHover className="py-3">
  {topUsers.map((u) => <TopCard key={u.id} user={u} />)}
</Marquee>
<Marquee direction="right" speed={60}>
  {moreUsers.map((u) => <TopCard key={u.id} user={u} />)}
</Marquee>
```

### `CoinBalance` / `CoinIcon` — the economy

A custom **minted-coin glyph** (engraved “R”, warm gold gradient — not a generic
dollar sign) and a `tabular-nums`, locale-aware balance display that won't jitter
as values animate.

```tsx
<CoinBalance amount={1250000} compact variant="glass" />  // → 🪙 1.3M
<CoinIcon size="lg" glow />
```

### `CountrySelect` — multiselect with flags

Searchable, keyboard-navigable, multi-select country picker. Flag emojis are
derived from ISO codes via Regional Indicator Symbols, so the data table is tiny
and flags always match. Selections render as removable chips. Wired to the shared
`CountryCode` type.

```tsx
const [countries, setCountries] = useState<CountryCode[]>(['RU', 'US']);
<CountrySelect value={countries} onChange={setCountries} maxSelections={5} />;
```

### `Toaster` / `toast` — notifications

A dependency-free toast system with an imperative API callable from anywhere.
Spring enter/exit, an accessible live region, auto-dismiss, and an inline action.

```tsx
toast.success('Match found!', { description: 'Connecting…' });
toast.danger('Connection lost', { action: { label: 'Retry', onClick: retry } });
```

---

## Accessibility

- **Focus-visible rings** everywhere, using the shared accent `--ring` with an
  offset against the background; a global `:focus-visible` fallback is set in the
  base layer.
- **Keyboard:** all interactive Radix primitives ship full keyboard support;
  `CountrySelect` implements the combobox/listbox pattern (arrows, Home/End,
  Enter to toggle, Esc to close, focus return).
- **ARIA:** `IconButton` requires `aria-label`; `Avatar` presence dots,
  `Spinner`, and `Toaster` expose roles/labels; decorative nodes are
  `aria-hidden`.
- **Contrast:** palette tuned for **AA** on intended surfaces.
- **Reduced motion:** `prefers-reduced-motion` neutralizes durations (tokens) and
  all animations/transitions (global guard); JS-driven motion checks
  `useReducedMotion()`.

---

## Motion

Shared durations and easings give every component the same "voice":

- Interaction: snappy `--duration-fast` with `--ease-out-quart`; controls use a
  gentle spring (`--ease-out-back`).
- Reveals: `--duration-base` with named keyframes (`overlay-in`, `modal-in`,
  `popover-in`, …) driven off Radix `data-state`.
- Always honors reduced-motion.
