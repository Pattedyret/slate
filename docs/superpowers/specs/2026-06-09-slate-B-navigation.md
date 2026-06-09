# Slate — Package B: Canvas Navigation (Foundation)

**Date:** 2026-06-09
**Status:** Design spec — ready for review
**Package:** B (Pan / Pinch-zoom / Fullscreen / Collapsible menu)

## 1. Overview

Package B turns Slate's static, fixed-size canvas into a navigable viewport. It adds:

1. **Pan & pinch-zoom** — two-finger / trackpad pan and pinch on touch + trackpad,
   wheel-pan and ctrl/⌘+wheel zoom-to-cursor on mouse, plus on-screen zoom controls.
2. **A real fullscreen view** — driven by the Fullscreen API, with state reflected in
   the UI (enter/exit toggle) and a documented iOS limitation.
3. **A collapsible top menu** — one toggle hides the tab bar + toolbar; a small floating
   handle brings them back.

**Locked decision (do not revisit):** the viewport — pan position `(panX, panY)` and
zoom level `scale` — is **independent per device**. It is **local and ephemeral**: never
synced over the Realtime channel, never written to the `objects`/`boards` tables, never
persisted across reloads. Only **drawings** sync. Two devices looking at the same board
may be zoomed/panned to completely different regions, and that is correct behaviour.

**Why this is the foundation package.** Two of B's changes are structural prerequisites
for packages C (select/move/resize, text-edit overlay) and D (long-press placement):

- The **screen→world coordinate conversion** (Section 4). Once drawing and hit-testing
  speak world coordinates, every later feature inherits correctness at any zoom/pan for
  free. If B does not land first, C and D will be built against raw screen coords and
  will break the moment the user zooms.
- **Dynamic canvas sizing** (Section 8). The hardcoded `window.innerHeight - 88` must be
  replaced with a measured wrapper before the collapsible menu or fullscreen can resize
  the canvas correctly. C's text-edit overlay also positions itself relative to this
  same measured box.

See Section 11 for explicit cross-package sequencing.

## 2. Current state (ground truth)

- `src/board/Canvas.tsx` — Konva `<Stage>` with **no** `scaleX/scaleY/x/y` (zoom 1, pan 0).
  `pos(e)` returns `stage.getPointerPosition()` — **raw screen pixels**. Mouse + touch
  handlers forward those screen coords to `onPointerDown/Move/Up`. Grid (`GridDots`) is
  drawn in screen space from `(0,0)` to `(width,height)`. A `<Transformer>` handles
  select/resize; per-object `onDragEnd`/`onTransformEnd` read `node.x()/y()/scaleX()`.
- `src/board/BoardView.tsx` — owns `down/move/up`, the `draft` ref, `origin` ref,
  `erasing` ref, `hitTest`, `near`, `shapeData`. `size` state is
  `{ w: window.innerWidth, h: window.innerHeight - 88 }` (the `88` = two 44px bars),
  recomputed only on `window` resize. `onFullscreen` calls
  `document.documentElement.requestFullscreen?.()` and tracks **no** state.
- `src/styles.css` — `.app` is a flex column; `.tabbar` and `.toolbar` are each 44px
  (`--bar-h`); `.app canvas { flex: 1 0 auto }`.
- `src/board/Toolbar.tsx` — existing `grid` toggle + `⤢` fullscreen button.
- Coordinates are stored in **world space** in the DB. Today world == screen because the
  Stage has no transform, which is why raw screen coords happen to work. B breaks that
  identity, so the conversion becomes mandatory.

## 3. UX & behaviour

### 3.1 Pan

- **Touch:** two fingers down → dragging the two-finger centroid pans the board 1:1.
- **Trackpad:** two-finger scroll (a `wheel` event **without** `ctrlKey`) pans. Vertical
  scroll → pan Y; horizontal scroll (`deltaX`) → pan X. `shift`+wheel → pan X (for plain
  mouse wheels that only emit `deltaY`).
- **Mouse:** plain wheel pans Y; `shift`+wheel pans X. (Mouse users mostly rely on the
  on-screen controls and dragging at zoom; precise mouse panning is not a goal.)
- Panning has **no limits** — the board is an infinite plane.

### 3.2 Zoom

- **Touch:** two-finger **pinch** zooms. Pan and pinch happen **simultaneously** from the
  same two-finger gesture (centroid → pan, distance ratio → zoom), anchored on the
  gesture centroid so content under the fingers stays put.
- **Trackpad:** pinch arrives as a `wheel` event **with** `ctrlKey: true`. ⌘+wheel on
  Mac and ctrl+wheel elsewhere also zoom. Zoom is **anchored to the cursor** (zoom-to-cursor).
- **Mouse:** ctrl/⌘+wheel zooms to cursor. The on-screen **+ / −** buttons zoom in/out by
  a fixed step (×1.2 per click), anchored on the **viewport centre**.
- **Limits:** `MIN_SCALE = 0.1`, `MAX_SCALE = 8`. Every zoom path clamps to this range.
- **Reset control:** a "reset view" button (label e.g. `100%` or a target icon) restores
  `scale = 1`, `panX = 0`, `panY = 0` (world origin at the top-left of the canvas).
  (Open question 11.3: reset-to-100% vs fit-to-content.)
- An optional **zoom indicator** shows the current percent (`Math.round(scale*100)%`) and
  doubles as the reset button (Open question 11.4).

### 3.3 Zoom-to-cursor formula (canonical)

Given a pointer at screen `(sx, sy)`, the world point under it before zoom is:

```
worldX = (sx - panX) / oldScale
worldY = (sy - panY) / oldScale
```

After choosing `newScale` (clamped), keep that world point under the same screen pixel:

```
panX = sx - worldX * newScale
panY = sy - worldY * newScale
```

For the +/− buttons and pinch, substitute the viewport-centre or gesture-centroid screen
point for `(sx, sy)`.

### 3.4 Fullscreen

- The `⤢` button toggles fullscreen on the **app root** element (the `.app` div, not
  `documentElement`, so our own chrome renders inside the fullscreen surface).
- State is tracked by listening to the `fullscreenchange` event (and `webkitfullscreenchange`
  for Safari). The button reflects state: shows "enter" affordance when windowed, "exit"
  when fullscreen, and toggling calls `requestFullscreen()` / `document.exitFullscreen()`
  accordingly. Pressing **Esc** (browser-native exit) updates the button automatically via
  the change listener.
- **Auto-collapse on enter:** see Open question 11.1 — recommended default **yes** (entering
  fullscreen auto-collapses the menu for maximum drawing space; exiting restores it).
- **iOS Safari caveat (edge case, not a nit):** Safari on iPhone has **no Fullscreen API for
  non-video elements** — `requestFullscreen` is `undefined`/no-ops there. For a phone-first
  multi-device app this matters: on iPhone the **collapsible menu is the "more space" path**,
  not fullscreen. The button must feature-detect (`el.requestFullscreen` present) and hide or
  disable itself when unavailable rather than appearing broken.

### 3.5 Collapsible top menu

- A **collapse toggle** hides both the tab bar and the toolbar ("the top menu"). When hidden,
  a small **floating handle** (a chevron pill, top-centre or top-right, over the canvas)
  brings the menu back.
- Collapsing/expanding changes the free vertical space; the canvas grows/shrinks to fill it
  automatically because sizing is measured (Section 8), **not** computed from the hardcoded 88.
- The handle is a fixed/absolute-positioned element overlaying the canvas with a high enough
  z-index and `touch-action: manipulation` so tapping it never starts a draw.

## 4. The screen ↔ world coordinate model (the linchpin)

**Stage carries the transform.** `<Stage scaleX={scale} scaleY={scale} x={panX} y={panY}>`.
Objects live in a normal, **untransformed** `<Layer>`; the Stage transform is the only place
zoom/pan is applied.

**Convert at exactly one boundary.** All screen→world conversion happens **inside
`Canvas.pos()`** and nowhere else. Replace:

```ts
const p = e.target.getStage()!.getPointerPosition()!   // screen pixels
```

with Konva's transform-aware accessor:

```ts
const p = e.target.getStage()!.getRelativePointerPosition()!  // WORLD coords
```

`getRelativePointerPosition()` returns the pointer in the Stage's local (world) space,
inverting `scale` and `(x,y)` for us. Because the conversion is centralised here:

- `down/move/up`, `hitTest`, `near`, `shapeData` in **BoardView stay byte-for-byte
  unchanged** — they already operate in world coords; they just now receive correct world
  coords at any zoom/pan.
- Strokes land **under the finger** at any zoom/pan (draw correctness), and they are
  **stored in world coords**, so they sync correctly to a device with a different viewport
  (sync correctness). This is the whole point.

**Existing drag/resize math is invariant under the Stage transform — do not touch it.**
Because `scale`/`pan` live on the Stage while nodes live in an untransformed Layer,
`node.x()`, `node.y()`, `node.width() * node.scaleX()` etc. already return **world** values.
So Canvas.tsx's per-object `onDragEnd`/`onTransformEnd` handlers need **zero changes** for
Package B. (This is called out again in Section 11 so Package C does not double-convert.)

**The only world→screen conversion anywhere** is for HTML overlays positioned over the
canvas (Package C's text-edit `<textarea>`, and any future popovers):

```
screenX = panX + scale * worldX
screenY = panY + scale * worldY
```

B does not need this itself; it is documented here as the contract C builds on.

## 5. Input-event mapping

| Device | Gesture / Event | Condition | Action |
|---|---|---|---|
| **Touch** | 1 finger down/move/up | `touches.length === 1` | **Draw** (existing pen/shape/eraser/text flow) |
| **Touch** | 2 fingers down | second finger lands | **Cancel any in-progress 1-finger draft** (Section 6.1), begin pan+pinch |
| **Touch** | 2 fingers move | `touches.length === 2` | **Pan** (centroid delta) **+ pinch-zoom** (distance ratio), anchored on centroid |
| **Touch** | finger lifted → 1 left | `2 → 1` | End nav gesture; do **not** resume drawing until all fingers lift and a fresh 1-finger touch begins |
| **Trackpad** | two-finger scroll → `wheel` | `!e.ctrlKey` | **Pan** by `(deltaX, deltaY)` |
| **Trackpad** | pinch → `wheel` | `e.ctrlKey === true` | **Zoom to cursor** |
| **Mouse** | wheel | `!ctrlKey && !shiftKey` | **Pan Y** by `deltaY` |
| **Mouse** | shift + wheel | `shiftKey` | **Pan X** by `deltaY` |
| **Mouse** | ctrl/⌘ + wheel | `ctrlKey \|\| metaKey` | **Zoom to cursor** |
| **On-screen** | `+` / `−` button | — | Zoom in/out ×1.2, anchored on viewport centre |
| **On-screen** | reset/`100%` button | — | `scale=1, panX=0, panY=0` |

**The trackpad-vs-mouse ambiguity is resolved by `ctrlKey`:** browsers synthesise
`ctrlKey: true` on the `wheel` event for a trackpad pinch and leave it `false` for a
two-finger scroll. We therefore treat **plain wheel = pan, ctrl/⌘+wheel = zoom**. This is
the standard convention (used by Figma, tldraw, Excalidraw). Plain-mouse users — who cannot
pinch — get pan from the wheel and **must** have the on-screen +/− and reset controls; that
is why those controls are mandatory, not optional.

**Wheel must be a non-passive listener.** `preventDefault()` on a `wheel` event (needed to
stop the browser's own page-zoom on ctrl/⌘+wheel and rubber-band scroll on trackpad pan)
is ignored on a passive listener. Verify Konva's `onWheel` prop binds non-passively; if it
does not, attach a manual `addEventListener('wheel', handler, { passive: false })` on the
Stage's container in a `useEffect` and call `preventDefault()` there. Touch handlers already
call `e.evt.preventDefault()` and the stage already sets `touch-action: none`.

## 6. Edge cases

### 6.1 Second finger cancels an in-progress draft (new teardown path)

Today `up()` is the **only** teardown for a draft and it **commits**. If a user starts a
one-finger stroke and then lands a second finger to pan/zoom, the half-drawn stroke must be
**discarded**, not committed on the trailing `touchend`. This requires a **new
Canvas→BoardView callback `onDrawCancel`** that nulls `draft.current` and `origin.current`
and resets `erasing.current = false` **without** committing or broadcasting. Canvas fires it
the instant `touches.length` becomes 2 while a draft is active. After a multi-touch gesture,
drawing only resumes on a fresh single-finger `touchstart`.

### 6.2 Other edge cases

- **Clamp at limits:** zooming past `MIN_SCALE`/`MAX_SCALE` is clamped; the gesture does not
  "stick" — further zoom-out at 0.1× is a no-op (pan still works).
- **Eraser drag at zoom:** `near()` uses fixed world-space thresholds (e.g. `< 12`). At high
  zoom-out these become a small on-screen radius and at high zoom-in a large one — acceptable
  for v1; note it as a known characteristic. (No change required; flagged for awareness.)
- **Resize during gesture:** a `window`/wrapper resize mid-pan must not corrupt `(panX, panY)`
  (they are independent of size). Verified by Section 8 measuring asynchronously.
- **Fullscreen unsupported (iOS):** button feature-detects and hides/disables (Section 3.4).
- **Collapsed menu + fullscreen + reset:** all three compose; reset only touches the
  viewport, never the menu/fullscreen state.
- **Grid at extreme zoom-out:** density guard prevents rendering 100×+ dots (Section 7).
- **Konva pixel ratio:** zoom changes Stage scale, not canvas backing resolution; lines stay
  crisp because Konva re-rasterises vector shapes per frame. No DPR handling needed.

## 7. Grid under pan/zoom

**Recommendation: draw the grid in world space, covering the visible world rectangle.** The
dots then **align to content** (a dot at world `(24,24)` stays glued to that world point as
you pan/zoom) and always fill the screen.

Approach in `GridDots`:

1. Compute the **visible world rect** from the inverse transform:
   `worldLeft = -panX/scale`, `worldTop = -panY/scale`,
   `worldRight = (width - panX)/scale`, `worldBottom = (height - panY)/scale`.
2. Iterate grid **indices** (`floor(worldLeft/gap)` … `ceil(worldRight/gap)`) and emit a dot
   at each `(i*gap, j*gap)` world position. The Stage transform paints them at the right
   screen spot; dot `radius` is kept visually constant by dividing by `scale` (e.g.
   `1.2 / scale`) so dots don't balloon when zoomed in.
3. **Density / LOD guard (required):** when on-screen spacing `gap * scale` drops below
   ~6px (deep zoom-out), multiply the effective `gap` (e.g. ×5) or hide the grid entirely.
   Without this, at 0.1× you render ~100× the dots and tank the frame rate.
4. **Memoise on a quantised visible-rect**, i.e. on the integer grid-index bounds, **not** on
   continuous `panX/panY`. Otherwise the `useMemo` recomputes the whole dot array every
   animation frame during a pan.

Alternative considered and rejected: keeping the grid in screen space (current behaviour).
It fills the screen but the dots **slide independently of content**, which looks wrong and
gives no spatial anchor while panning.

## 8. Component & file changes

### 8.1 New: `src/board/useViewport.ts` (hook)

Owns the ephemeral viewport state and the math. Returns:

```ts
{ scale, panX, panY,
  panBy(dx, dy),                       // additive pan (screen-space delta)
  zoomAt(screenX, screenY, factor),    // clamped zoom-to-point (Section 3.3)
  zoomIn(), zoomOut(),                 // ×1.2 at viewport centre
  reset(),                             // scale=1, pan=0,0
  setSize(w, h) }                      // viewport centre needs current size
```

State is `useState`/`useRef` inside the hook — **not** persisted, **not** synced. Clamping to
`[MIN_SCALE, MAX_SCALE]` lives here. Constants `MIN_SCALE = 0.1`, `MAX_SCALE = 8`,
`ZOOM_STEP = 1.2`.

### 8.2 New: `src/board/useElementSize.ts` (hook) — dynamic sizing

Replaces the hardcoded `window.innerHeight - 88`. Returns a `ref` to attach to a wrapper
element and the measured `{ w, h }`, updated via a **`ResizeObserver`** on the **wrapper**
(see CSS below). **Measure the wrapper, not the canvas** — observing the canvas element
itself feedback-loops (the canvas size depends on the measurement). Initial size falls back
to `window.innerWidth × (window.innerHeight - 88)` for the first paint before the observer
fires.

### 8.3 `src/styles.css`

Add a measured wrapper around the canvas:

```css
.canvas-wrap {
  flex: 1;
  min-height: 0;     /* mandatory in a flex column, else the canvas overflows the bars */
  position: relative;/* anchor for floating handle + zoom controls + (later) text overlay */
}
```

Add styles for: `.menu-handle` (floating chevron pill, absolute, top-centre), `.zoom-controls`
(absolute bottom-right pill with `+ / − / 100%`). Keep `.app canvas { display:block;
touch-action:none }` but drop `flex: 1 0 auto` (the wrapper now flexes; the canvas takes
explicit px from Konva).

### 8.4 `src/board/Canvas.tsx`

- **Props:** add `scale, panX, panY` and `onWheel`, `onTouchPan` (or handle pan/pinch inside
  Canvas — see below), and `onDrawCancel`.
- **Stage:** add `scaleX={scale} scaleY={scale} x={panX} y={panY}`.
- **`pos()`:** swap `getPointerPosition()` → `getRelativePointerPosition()`. (One-line change;
  the linchpin.)
- **Touch handlers:** in `onTouchStart`/`onTouchMove`, branch on `e.evt.touches.length`:
  `1` → existing draw path; `2` → fire `onDrawCancel` once (if a draft is live) then drive
  pan+pinch (compute centroid + distance, call `panBy`/`zoomAt`). Track previous centroid &
  distance in a `useRef`.
- **Wheel:** add a non-passive `wheel` handler (Section 5): `ctrl/⌘` → `zoomAt(cursor)`,
  else → `panBy(deltaX || 0, ctrl?0:deltaY)`; `shift` maps `deltaY`→X. `preventDefault()`.
- **Grid:** rewrite `GridDots` per Section 7 (now needs `scale, panX, panY` to compute the
  visible world rect). Per-object render code and the `<Transformer>` are **unchanged**.

> Design choice: pan/pinch/wheel math can live **inside Canvas** (it already owns the Stage
> and pointer events) calling the `useViewport` actions passed down, OR Canvas can forward raw
> events up to BoardView. Recommended: keep the **gesture interpretation in Canvas** and pass
> down `useViewport`'s action callbacks — Canvas is the natural owner of pointer/touch/wheel
> events, and BoardView stays focused on the object model.

### 8.5 `src/board/BoardView.tsx`

- Instantiate `const vp = useViewport()` and `const { ref: wrapRef, size } = useElementSize()`.
- **Delete** the `size` `useState` + the `window` `resize` `useEffect` that compute
  `innerHeight - 88`. Use the measured `size` instead.
- Add `const [menuHidden, setMenuHidden] = useState(false)`.
- Add `const [isFs, setIsFs] = useState(false)` + a `useEffect` listening to
  `fullscreenchange`/`webkitfullscreenchange` to keep `isFs` in sync.
- Rework `onFullscreen` → `toggleFullscreen` (request on `.app` root via a ref; exit via
  `document.exitFullscreen`); optionally `setMenuHidden(true)` on enter (Open question 11.1).
- Add `onDrawCancel = () => { draft.current = null; origin.current = null;
  erasing.current = false; force(n => n + 1) }`.
- Render: wrap `<Canvas>` in `<div className="canvas-wrap" ref={wrapRef}>`; conditionally
  render `<TabBar>` + `<Toolbar>` only when `!menuHidden`; render the floating `.menu-handle`
  when `menuHidden`; render `.zoom-controls`. Pass `scale/panX/panY` and the viewport action
  callbacks + `onDrawCancel` to `<Canvas>`; pass `vp.setSize(size.w, size.h)` on size change.

### 8.6 `src/board/Toolbar.tsx`

- Replace the single `⤢` button with a fullscreen **toggle** reflecting `isFs` (enter/exit
  glyph), hidden/disabled when the Fullscreen API is unavailable (iOS).
- Add a **collapse-menu** button (chevron) that calls `toggleMenu`.
- (Zoom +/−/reset can live either in the toolbar or in the floating `.zoom-controls` pill;
  recommended in the floating pill so they remain reachable when the menu is collapsed.)
- Update `Props` accordingly: `isFs`, `onToggleFullscreen`, `fullscreenSupported`, `onCollapseMenu`.

### 8.7 No changes

`useTool.ts`, `useBoardObjects.ts`, `useBoards.ts`, `realtime.ts`, `types.ts`, `objects.ts`,
`history.ts`, the DB schema, and **all per-object drag/resize handlers in Canvas.tsx**.

## 9. Testing

Add `tests/e2e/navigation.spec.ts` (Playwright; matches existing `*.spec.ts` style, reusing
the sign-up→board bootstrap from `draw-sync.spec.ts`). The Stage transform is read via
`window`-exposed viewport state or by reading Konva from `page.evaluate`; recommended to
expose a tiny `window.__slate = { getViewport() }` test hook in dev/test builds so tests
assert on `{ scale, panX, panY }` deterministically (no Konva-internals scraping).

1. **Wheel pan changes the transform:** dispatch a `wheel` event over the canvas; assert
   `panY` changed and `scale` did not.
2. **Ctrl+wheel zooms to cursor:** dispatch `wheel` with `ctrlKey:true` at a known point;
   assert `scale` increased (clamped ≤ 8) and the world point under the cursor is preserved
   (`(sx-panX)/scale` stable within tolerance).
3. **Zoom limits:** repeated zoom-out clamps at `0.1`, zoom-in at `8`.
4. **Reset:** after pan+zoom, click reset → `scale===1, panX===0, panY===0`.
5. **★ Stroke at zoom/pan persists at correct world coords (the headline correctness test):**
   set a known viewport (e.g. `scale=2, panX=-100, panY=-50` via the test hook or gestures),
   draw a stroke at a known **screen** point, then read the committed object from Postgres
   (as in `draw-sync.spec.ts`) and assert its first stored point equals the expected **world**
   coord `((sx-panX)/scale, (sy-panY)/scale)` within tolerance — proving strokes are stored in
   world space, not screen space.
6. **Second finger cancels draft:** start a one-finger touch draw, add a second touch, lift
   both; assert **no** new object was persisted (the draft was discarded, not committed).
7. **Menu toggle:** click collapse → tab bar + toolbar are not visible, the floating handle
   is; assert the canvas's measured height **grew** (transform/box size). Click the handle →
   menu returns, canvas shrinks back.
8. **Fullscreen state:** click the fullscreen toggle → assert `document.fullscreenElement` is
   the `.app` root and the button shows the "exit" state; programmatically exit → button
   returns to "enter". (Guard/skip on engines without the API.)
9. **Grid sanity:** at deep zoom-out the density guard keeps the dot count bounded (assert a
   reasonable upper bound on grid nodes, or that the grid hides).

Unit tests (`tests/*.test.ts`, Vitest) for `useViewport` math: `zoomAt` preserves the anchor
point; clamping; `reset`; `panBy` additivity.

## 10. Edge-case checklist (quick reference)

- [ ] Draft discarded (not committed) when 2nd finger lands.
- [ ] Drawing only resumes after all fingers lift, on a fresh single touch.
- [ ] Zoom clamped to `[0.1, 8]` on every path (wheel, pinch, buttons).
- [ ] `preventDefault` on ctrl/⌘+wheel (non-passive listener) so the browser doesn't page-zoom.
- [ ] Fullscreen button feature-detects and degrades on iOS.
- [ ] Esc-exit from fullscreen updates the button (change listener).
- [ ] Grid density guard active at deep zoom-out; grid memoised on quantised bounds.
- [ ] `min-height: 0` on `.canvas-wrap` so the canvas never overflows the bars.
- [ ] ResizeObserver on the wrapper, not the canvas (no feedback loop).
- [ ] Viewport never sent over `realtime.ts` and never written to the DB.

## 11. Cross-package coupling & sequencing

**Package B is the foundation and MUST land before C and D.** Two B changes are hard
prerequisites:

1. **Screen→world conversion (`getRelativePointerPosition` in `Canvas.pos()`).**
   - **Package C (select/move/resize, text edit):** C's drag/resize math reads
     `node.x()/y()/width()*scaleX()`, which are **already world coords** because the transform
     is on the Stage and nodes are in an untransformed Layer — so C must **not** add its own
     screen→world conversion to drag/resize. The **one** place C needs **world→screen** is
     positioning the HTML text-edit `<textarea>` overlay: `screenX = panX + scale*worldX`
     (Section 4). C depends on B exposing `scale/panX/panY` (via `useViewport`) for that.
   - **Package D (long-press to place):** D's long-press handler must read the **world**
     coordinate of the press (the same `pos()` boundary) so placed objects land correctly at
     any zoom/pan and sync correctly. If D is built on raw screen coords it breaks under zoom.

2. **Dynamic canvas sizing (`useElementSize` + `.canvas-wrap`).**
   - **Package C:** the text-edit overlay is positioned relative to the `.canvas-wrap`
     bounding box (the `position: relative` anchor added in 8.3). The wrapper must exist first.

**Recommended order:** B (this package) → C → D. B introduces no behavioural change to the
existing object/sync model (drag/resize math and the DB schema are untouched), so it is a
safe, isolated first landing. C and D then build on the world-coordinate contract and the
measured wrapper without re-touching coordinate plumbing.

## 12. Open questions (for the user)

1. **Auto-collapse the menu when entering fullscreen?** Recommended **yes** (max drawing
   space; interacts with the iOS no-fullscreen limitation where collapse is the only path).
2. **Confirm zoom limits `0.1×–8×`?** (Affects how far out the infinite board can be surveyed.)
3. **Reset control behaviour — reset-to-100% (`scale=1`, origin top-left) or fit-to-content
   (frame all objects)?** Fit-to-content is friendlier on an infinite board but more code.
4. **Show a live zoom-percent indicator** (e.g. `150%`), and should it double as the reset
   button?
5. **iOS fullscreen:** confirm hiding/disabling the fullscreen button on iPhone (vs. showing a
   disabled state with a tooltip) is acceptable.
