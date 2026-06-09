# Slate — Package D: S Pen Radial Quick Menu

**Date:** 2026-06-09
**Status:** Design spec — ready for review (implementation blocked on Package B; see §10)
**Depends on:** Package B (reworked pointer pipeline / pan-zoom). Coordinates with Package C.

## 1. Overview

Today the only way to change tool, color, or size is the top **Toolbar**
(`src/board/Toolbar.tsx`). On a tablet held in two hands — the canonical Slate use
case, drawing on a phone/tablet to mirror onto a big screen — reaching the top bar
means breaking the drawing posture, and with a **Samsung S Pen** it means lifting the
stylus and crossing the whole screen.

Package D adds a **radial ("pie") quick menu**: the user **presses and holds** the
stylus (or finger, or mouse) in one spot for ~500 ms, and a circular menu fades in
**centered on the press point**. From it they can swap **tool, color, and size**
(the locked decision: the wheel is full quick control, not tools-only) without ever
travelling to the top bar. Tap a sector to select; tap outside or release to dismiss.

The menu is an **HTML/SVG overlay**, not a Konva object — it is pure UI chrome, lives
in screen space, never syncs, and is trivially dismissable. The hard part is the
**gesture**: a long-press must arm cleanly without leaving a stray dot or stroke, and
without fighting normal drawing, hold-to-erase, or the two-finger pan/zoom that
Package B introduces.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Wheel contents | **Tools + Colors + Size** (full quick control) |
| Trigger | **Long-press** (~500 ms) on a single stationary pointer |
| Primary input | **Samsung S Pen** (also works for touch + mouse) |
| Rendering | **HTML/SVG overlay** centered at the press point (not drawn in Konva) |
| v1 selection | **Tap-to-select** a sector; tap-outside / release dismisses |
| v1.1 enhancement | **Press-drag-release** ("hold, slide to a sector, lift") — S-Pen-friendly |
| Coordinate space | **Screen space** at the press point (no world coords needed) |
| Pointer detection | Migrate canvas input to **Pointer Events** so `pointerType` is available |

## 3. The trigger — long-press gesture detection

### 3.1 Timing & threshold

| Parameter | Value | Notes |
|---|---|---|
| `LONGPRESS_MS` | **500 ms** | Tunable 450–550. S Pen taps are crisp; 500 ms avoids accidental opens. |
| `MOVE_TOLERANCE_PX` | **8 px** (screen) | Movement beyond this before the timer fires cancels the long-press → it becomes a normal draw/drag. Stylus jitter is small; 8 px is forgiving without false-firing. |
| Re-arm | On each fresh single-pointer down | Timer is cleared on up, on cancel, on a 2nd pointer arriving, and on move-beyond-tolerance. |

### 3.2 Lifecycle

```
pointerdown (single pointer)
   │  record (downX, downY, pointerType, pointerId, t0)
   │  start LONGPRESS_MS timer
   │  ALSO let the normal draw path run (a draft may start — see 3.3)
   ▼
pointermove
   │  if hypot(x-downX, y-downY) > MOVE_TOLERANCE_PX  → CANCEL timer (normal draw)
   ▼
timer fires (still down, still within tolerance, still single pointer)
   │  → CANCEL the in-progress draft (3.3)
   │  → OPEN radial menu at (downX, downY)  [screen coords]
   │  → swallow further move/up for THIS gesture (menu owns the pointer)
   ▼
pointerup BEFORE timer  → cancel timer → normal tap/draw commit (unchanged behavior)
```

### 3.3 Draft cancellation — never leave a dot

The current pipeline starts a draft **immediately** on down:
`BoardView.down()` does `draft.current = base('stroke', { points: [x, y], … })` for
pen, and sets `origin.current` for shapes (`src/board/BoardView.tsx:46`). The eraser
sets `erasing.current = true` and may already have deleted a hit object
(`BoardView.tsx:49`). So by the time the 500 ms timer fires, **state has already been
mutated**. The long-press handler must undo it:

- **pen / shapes (local):** set `draft.current = null` and `origin.current = null`,
  then `force()` a re-render so the partial stroke/shape disappears. Commit happens
  only in `up()` (`BoardView.tsx:80`), so the *local* device never persists or
  finalizes the canceled draft.
- **pen / shapes (mirror devices) — REQUIRED, this is the real leak.** `BoardView.move`
  calls `throttledSendPoints(channel.current, d)` on **every** move
  (`BoardView.tsx:77`), including sub-pixel jitter *within* the 8 px tolerance while the
  user holds still. Each call broadcasts an `onLive` message, and on the receiving side
  `useBoardObjects` stores it in `liveDrafts[id]` and **only ever removes it on an
  `onCommit` or `onDelete` for that id** (`useBoardObjects.ts:30,34`). A canceled
  long-press emits neither → the in-flight points become a **permanent ghost stroke on
  every mirror device.** Remedy (mirror of the deferred-eraser-delete design): **defer
  the first `sendPoints` broadcast until movement exceeds `MOVE_TOLERANCE_PX`.** While
  the pointer is still a long-press candidate (stationary, single pointer, timer
  running) `move` must NOT broadcast. Only once tolerance is crossed — at which point
  the gesture is committed to being a real stroke, not a menu open — does broadcasting
  begin. As a belt-and-suspenders fallback, when the long-press fires we MAY broadcast a
  one-shot `sendDelete(draft.id)` so any mirror that did receive points clears them; but
  deferring the broadcast is the primary fix and avoids the cleanup entirely.
- **eraser:** this is the sharp edge. `down()` may have already deleted the
  topmost object under the press point **before** we know it's a long-press. v1 rule:
  **arming the radial menu does NOT restore an already-erased object** — instead we
  *prevent the first delete* by deferring it (see §6, eraser precedence). The eraser
  delete-on-down moves behind a tiny guard: on down, record the hit but do not delete
  until either (a) the pointer moves beyond tolerance (real erase drag begins) or
  (b) `pointerup` before the long-press timer (a deliberate erase tap). If the long
  press fires first, no delete happened.
- **text:** `window.prompt` is synchronous and blocking. v1 rule: **text tool does not
  arm the radial menu** — the prompt fires on down as today. (A long-press makes no
  sense mid-prompt.) Documented as an intentional exception in §6.

### 3.4 Pointer-type strategy — migrate to Pointer Events

The canvas today wires **separate** Konva handlers: `onMouseDown/Move/Up` and
`onTouchStart/Move/End` (`src/board/Canvas.tsx:70–102`), and reads position via
`getStage().getPointerPosition()`. Neither path exposes `pointerType`, so we cannot
distinguish S Pen from finger from mouse.

**Recommendation: route canvas input through Pointer Events.** Two viable mechanics —
choose during implementation in coordination with Package B (which is also reworking
this pipeline):

1. **Preferred — attach a pointer listener to the Stage container.**
   Konva renders into a `<div>` container we can reach via
   `stageRef.current.container()`. Add `pointerdown/move/up/cancel` listeners there
   (with `{ passive: false }` so we can `preventDefault`). Each event gives
   `e.pointerType` (`'pen' | 'touch' | 'mouse'`), `e.pointerId`, `e.isPrimary`, and
   coordinates we convert to stage space with `stage.getPointerPosition()` /
   `stage.setPointersPositions(e)`. The long-press hook lives entirely here, and the
   existing `onMouse*/onTouch*` props can be retired or reduced to a thin shim.

2. **Fallback — keep Konva handlers, read `pointerType` off the native event.**
   Konva's `KonvaEventObject.evt` is the underlying DOM event. On modern browsers the
   touch/mouse events Konva forwards do not reliably carry `pointerType`, so this path
   is **strictly inferior** and only kept as a stopgap. Prefer option 1.

The menu is **available for all pointer types** (mouse users long-press too), but
defaults and timing are tuned for `pen`. We may expose `pointerType` to `BoardView`
so future tuning (e.g. shorter timer for `pen`) is a one-line change.

> CSS note: the Stage already sets `touch-action: none` (`Canvas.tsx:69`). Keep it;
> Pointer Events still need it to suppress browser scroll/zoom on the canvas.

## 4. Radial menu layout (tools + colors + size)

Three concentric zones around the press point, plus a dead-zone center.

- **Center hub (dead zone, r ≈ 0–28 px):** shows the *current* tool glyph. Tapping it
  (or tapping outside the wheel) **dismisses** without changing anything. Acts as the
  "cancel" target and prevents accidental selection right under the stylus tip.
- **Inner ring — TOOLS (r ≈ 28–86 px):** the 8 tools from
  `useTool.ts` (`pen, eraser, line, rect, ellipse, arrow, text, select`) as 8 equal
  45° sectors. The active tool's sector is highlighted (mirrors the Toolbar `.active`
  class). Tapping a sector calls `setTool(tool)` and dismisses.
- **Outer ring — COLORS (r ≈ 86–124 px):** the 6 `PALETTE` swatches
  (`useTool.ts:3`) as 6 equal 60° arc segments, each filled with its color. Tapping
  calls `setColor(c)`. The active color shows a ring outline (mirrors Toolbar
  `.swatch.active`).
- **Size control:** a small **arc stepper** occupying the bottom ~90° gap of the outer
  band, or a 3-stop quick selector (S/M/L → e.g. 2 / 6 / 14). Tapping `–` / `+`
  steps `size` by 2 within the existing **1–24** range (the Toolbar slider's bounds,
  `Toolbar.tsx:24`). Current value shown numerically. Picking a discrete stop calls
  `setSize(n)`.

Selecting tool / color / size **does not auto-dismiss** for color & size (so the user
can tweak both in one open), but selecting a **tool** dismisses immediately (tool is
the primary intent). Tunable; called out as an open question (§9).

### 4.1 ASCII sketch

```
                      ╔══════════════════════╗
                      ║   colors (outer arc) ║
                  ┌───────────────────────────────┐
                  │   ◯●◯◯◯◯   ← 6 palette swatches │
              ┌───┴───────────────────────────┴───┐
              │      ╱ pen │ erase ╲                │
              │   text ╱   ┌─────┐   ╲ line         │   ← inner ring: 8 tools
              │  select│   │ pen │   │ rect         │     (center hub = current
              │        │   └─────┘   │              │      tool + tap-to-cancel)
              │   arrow ╲   hub    ╱ ellipse        │
              │          ╲ _____ ╱                  │
              └───┬───────────────────────────┬───┘
                  │        ▁▁▁  size  ▁▁▁          │
                  │      –   [ 6 ]   +   (S M L)   │  ← size stepper in bottom gap
                  └───────────────────────────────┘
                press point = wheel center (screen coords)
```

(Indicative; exact radii/angles are CSS/SVG constants in the component.)

### 4.2 Visual & edge-aware behavior

- Style matches the existing dark theme (`src/styles.css`) — translucent dark disc,
  subtle border, the same 6 palette colors, the same `.active` highlight language.
- **Edge clamping:** if the press point is near a screen edge, the wheel would clip.
  Clamp the wheel center inward so the full ring stays on-screen, while a small pointer
  "tail" still indicates the true press point. (Open question §9: clamp vs. partial
  wheel.)
- Fade-in ~120 ms; fade-out on dismiss. No layout shift of the canvas.

## 5. Component / file changes

### 5.1 New files

- **`src/board/RadialMenu.tsx`** — presentational overlay. Props:
  ```ts
  interface RadialMenuProps {
    x: number; y: number           // screen-space center (press point, clamped)
    tool: Tool; color: string; size: number
    onPickTool: (t: Tool) => void
    onPickColor: (c: string) => void
    onPickSize: (n: number) => void
    onDismiss: () => void
  }
  ```
  Renders an absolutely-positioned `<div>`/`<svg>` over the canvas. Imports `PALETTE`
  and `Tool` from `useTool.ts`. **To keep the tool list single-sourced**, hoist the
  `TOOLS` array (currently declared in `Toolbar.tsx:3`) **into `useTool.ts`** and have
  both `Toolbar` and `RadialMenu` import it — otherwise the wheel and the toolbar can
  drift. Pure UI — no canvas, no Konva, no sync.

- **`src/board/useLongPress.ts`** — gesture hook. Owns the timer, the move-tolerance
  check, the pointer-type capture, and the open/close state. Suggested shape:
  ```ts
  function useLongPress(opts: {
    delayMs?: number; moveTolPx?: number;
    onLongPress: (p: { x: number; y: number; pointerType: string }) => void;
  }): {
    onDown: (x: number, y: number, pointerType: string, pointerId: number) => void;
    onMove: (x: number, y: number) => boolean;   // returns true if still a candidate
    onUp: () => void;
    cancel: () => void;
  }
  ```
  Returns booleans/callbacks BoardView uses to decide whether a given down/move/up is
  "armed for long-press" vs "normal draw". No React state churn during the hold beyond
  what's needed.

### 5.2 Edited files

- **`src/board/Canvas.tsx`** — input layer. Migrate to Pointer Events per §3.4
  (attach pointer listeners on the Stage container, expose `pointerType` + `pointerId`
  through the existing `onPointerDown/Move/Up` prop callbacks by **widening their
  signatures**). This is the same surface Package B reworks → must be coordinated
  (§10). The new `RadialMenu` is rendered **as a sibling of the Stage**, inside the
  same wrapper, NOT inside the Konva tree.

- **`src/board/BoardView.tsx`** — orchestration. Wire `useLongPress` into `down`/
  `move`/`up` (`BoardView.tsx:46–89`):
  - Add `const [menu, setMenu] = useState<{x:number;y:number}|null>(null)`.
  - In `down`: call `lp.onDown(...)` alongside the existing draft start; defer the
    eraser's first delete per §3.3.
  - In `move`: call `lp.onMove(...)`; if it reports the long-press cancelled, proceed
    as today; if the menu is open, ignore canvas move.
  - In `up`: `lp.onUp()`; if the menu is open, swallow the up (do **not** commit).
  - `onLongPress`: cancel draft/origin/eraser state, `force()`, `setMenu({x,y})`.
  - Render `{menu && <RadialMenu x={menu.x} y={menu.y} tool={t.tool} color={t.color}
    size={t.size} onPickTool={...} onPickColor={...} onPickSize={...}
    onDismiss={() => setMenu(null)} />}` next to `<Canvas/>`.
  - Tool/color/size wiring reuses the **existing** `t.setTool / t.setColor / t.setSize`
    from `useTool()` (`BoardView.tsx:23`) — the wheel writes to the same store the
    Toolbar does, so the Toolbar reflects changes instantly. The `useTool()` **API**
    already covers all three actions, so no setter changes are needed; the only edit to
    `useTool.ts` is the small **`TOOLS` hoist** noted in §5.1 (and optionally a discrete
    `stepSize` helper). `BoardView.move` is edited to **defer `sendPoints` until movement
    exceeds tolerance** (§3.3, mirror-ghost fix).

- **`src/board/useTool.ts`** — small change only: **hoist the `TOOLS` array here**
  (from `Toolbar.tsx:3`) so `Toolbar` and `RadialMenu` share one source. Optionally add
  a `stepSize`/`cycleSize` helper for the wheel's discrete size stops. The
  `tool/setTool/color/setColor/size/setSize` API is otherwise unchanged.

- **`src/styles.css`** — add `.radial-menu`, sector, swatch-arc, and size-stepper
  styles, reusing existing color/active conventions.

### 5.3 Dependency-flow check (per architecture guidance)

`useLongPress` (logic) ← `BoardView` (orchestration) → `RadialMenu` (presentation).
`RadialMenu` depends only on `useTool` types/constants, never the reverse. Canvas
stays the input boundary. No layer reaches upward.

## 6. Edge cases & gesture precedence

Precedence, highest first:

1. **Two-finger / multi-pointer (Package B pan-zoom) wins over long-press.**
   The long-press only arms on a **single primary pointer**. The instant a *second*
   pointer goes down, `useLongPress.cancel()` fires and the menu never opens (and if it
   somehow just opened, the second pointer dismisses it). This guarantees pinch-zoom /
   two-finger-pan from Package B is never hijacked.
2. **Movement beyond tolerance → normal draw/drag.** A quick stroke that moves >8 px
   within 500 ms is an ordinary stroke; the timer is cancelled, nothing pops.
3. **Release before 500 ms → normal tap/commit.** Unchanged from today.
4. **Eraser hold-to-erase still works.** With the deferred-delete guard (§3.3), holding
   the eraser and *moving* erases as before (move beyond tolerance cancels the
   long-press immediately, so dragging the eraser never opens the wheel). Holding the
   eraser *stationary* for 500 ms opens the wheel instead of deleting — this is the
   intended quick-swap affordance. A stationary eraser tap (down+up < 500 ms) still
   deletes the top hit, preserving tap-to-erase.
5. **Select tool:** long-press still opens the wheel. Today `down()` returns early for
   select (`BoardView.tsx:63`) and selection is via Konva node `onClick`/`onTap`. The
   long-press hook must observe pointerdown even in select mode (Canvas currently
   swallows pointer-down when `selectable`, `Canvas.tsx:72`). Implementation: route the
   long-press detection at the **container/pointer-events layer** so it sees down events
   regardless of `selectable`, while still letting Konva node clicks select objects when
   it's a short tap on a node. Long-press on empty canvas in select mode → wheel opens.
   (Open question §9: should long-press on a *selected object* open the wheel or a
   context action? v1: still opens the tool wheel.)
6. **Text tool exception:** does not arm the wheel — `window.prompt` fires on down as
   today (§3.3). Documented, intentional.
7. **Menu open, pointer still down (v1.1 press-drag):** sliding to a sector and lifting
   selects that sector. In v1 (tap-to-select) the down that opened the menu is consumed;
   a *separate* tap chooses a sector.
8. **Resize / window blur / route change while open:** dismiss the menu (it's transient
   chrome). Listen for `blur`, `resize`, and board-tab switch.
9. **Rapid re-press:** opening is idempotent — a second long-press while open
   re-centers (or is ignored); pick one in implementation, default re-center.
10. **Mirror devices:** the wheel is local-only chrome; it is **never** broadcast and
    never written to `objects`. Other devices see nothing. The cancelled draft never
    commits AND — critically — never broadcasts its in-flight points, because `move`
    defers `sendPoints` until movement exceeds tolerance (§3.3). Without that deferral,
    held-still jitter would leave a permanent ghost stroke on mirrors
    (`liveDrafts` only clear on `onCommit`/`onDelete`, `useBoardObjects.ts:30,34`).

## 7. Testing

### 7.1 Playwright e2e (primary acceptance)

Long-press is timing + movement based, so e2e drives synthetic pointer events.

1. **Menu appears on stationary long-press, no stray stroke.**
   - Navigate to a board (signed in / test board).
   - Dispatch `pointerdown` at (cx, cy) with `pointerType: 'pen'`; hold without moving;
     wait ~600 ms (> `LONGPRESS_MS`).
   - Assert the `.radial-menu` overlay is visible and centered near (cx, cy).
   - Assert **no new object** was committed (board object count unchanged) — proves
     draft cancellation. (Inspect via the app's object state or a test hook.)
2. **Selecting a tool sector changes the active tool.**
   - With the menu open, click the `eraser` sector.
   - Assert the menu dismisses AND the active tool is `eraser` — verify by the Toolbar's
     `eraser` button gaining `.active` (the wheel and Toolbar share `useTool`).
3. **Selecting a color / size updates state.**
   - Open menu, tap a palette arc → assert `.swatch.active` for that color in Toolbar.
   - Tap size `+` twice → assert the Toolbar range input value increased accordingly.
4. **Short tap still draws (no menu).**
   - `pointerdown` + `pointerup` < 500 ms with no move → assert a stroke committed and
     `.radial-menu` never appeared.
5. **Move beyond tolerance cancels (normal stroke).**
   - `pointerdown`, then `pointermove` >8 px within 200 ms, hold to 600 ms →
     assert a stroke is drawn and no menu.
6. **Two-pointer cancels long-press.**
   - `pointerdown` (id 1), wait 200 ms, `pointerdown` (id 2) → assert no menu opens.
     (Guards Package B's pinch.)
7. **Tap-outside / center dismisses without change.**
   - Open menu, click outside the wheel → assert dismissed and tool unchanged.
8. **No ghost stroke on a mirror device (regression for the broadcast-deferral fix).**
   - Two contexts on the same board (two Playwright pages / contexts signed into the
     same account). In page A, perform a stationary long-press (open the menu) then
     dismiss. In page B, assert **no live draft / no stroke** ever appears — proves
     `move` deferred `sendPoints` while the press was a long-press candidate
     (`useBoardObjects.liveDrafts` would otherwise retain it forever).

### 7.2 Manual / device

- Real Samsung tablet + **S Pen**: confirm 500 ms feels right; tune if the stylus
  fires too eagerly or feels sluggish. Confirm no ghost dot on open.
- Confirm hold-to-erase drag still erases; stationary eraser hold opens wheel.
- Confirm two-finger pan/zoom (once Package B lands) is never interrupted.

## 8. Scope

**In (v1)**
- Long-press detection (timer + tolerance + pointer-type) via `useLongPress`.
- `RadialMenu` overlay with tools (8) + colors (6) + size stepper.
- Tap-to-select; tap-outside/center to dismiss.
- Draft/eraser cancellation so holding never draws or deletes.
- Pointer-Events migration of canvas input (coordinated with Package B).

**Deferred (v1.1+)**
- Press-drag-release ("slide to sector, lift").
- Haptic feedback on sector cross.
- Long-press on a selected object → object context menu.
- Customizable wheel contents / per-pointer-type timing UI.

## 9. Open questions (for the user)

1. **Auto-dismiss policy:** should picking a *tool* dismiss immediately while color/size
   stay open (proposed), or should everything stay open until tap-outside?
2. **Edge behavior:** when the press is near a screen edge, **clamp** the whole wheel
   inward (proposed) or render a **partial** wheel that bleeds off-screen?
3. **Size control shape:** 3 discrete stops (S/M/L) vs. a `– [n] +` stepper across the
   full 1–24 range — which feels better for the S Pen?
4. **Long-press in select mode on an existing object:** open the tool wheel (proposed
   v1) or a per-object context menu (deferred)?
5. **Timing per pointer type:** keep a single 500 ms for all inputs, or a shorter delay
   for `pen` since the S Pen is precise?
6. **Should the eraser's deferred-delete (so a long-press doesn't first delete an
   object) be acceptable**, given it slightly changes when the first erase fires
   (on move/up instead of on down)?

## 10. Cross-package coupling & sequencing

**Package D edits the same two files as Packages B and C: `BoardView.tsx` and
`Canvas.tsx`.** This is a hard coupling, not incidental:

- **Package B (pan/zoom — the reworked pointer pipeline) is a hard prerequisite.**
  - B rewrites how Canvas turns raw pointer input into actions and (per the §3.4
    recommendation) is the natural owner of the **Pointer-Events migration**. D's
    long-press detector must live **inside B's pipeline**, not alongside a parallel one.
    Building D's pointer handling first would create a second, conflicting input path
    that B would then have to tear out.
  - B introduces **multi-pointer pan/zoom**. D's precedence rule #1 (a second pointer
    cancels the long-press) is meaningless until B exists to generate two-pointer
    gestures. The "single stationary primary pointer" guard is defined against B's
    multi-pointer model.
  - Once B adds canvas **pan/zoom transforms**, `getPointerPosition()` will return
    *world* coords, not screen coords. The radial menu needs the **screen** point. D
    must read the raw screen position (e.g. `stage.getPointerPosition()` *before*
    inverse-transform, or `e.clientX/Y` relative to the container), which is only
    well-defined after B settles the transform model. **D must consume B's
    screen-vs-world boundary, not guess it.**

- **Package C extends the same handlers.** Whatever C adds to `down/move/up` and the
  Canvas event surface must be merged with D's long-press branch. Coordinate the final
  signature of the `onPointerDown/Move/Up` props (D widens them to carry `pointerType`
  + `pointerId`; B/C likely also touch them).

**Sequencing (required order):**

1. **Package B lands first** — reworked Pointer-Events pipeline + pan/zoom + the
   screen↔world coordinate boundary. D is **blocked** until this merges.
2. **Package D lands after B** — `useLongPress` + `RadialMenu`, hooking into B's
   pipeline. Rebase onto B; do not branch D off the pre-B code.
3. **Coordinate with C** on the shared `BoardView`/`Canvas` edits — ideally land
   B → C → D (or B → D → C) on one shared branch lineage, reviewing the merged
   `down/move/up` and pointer-prop signatures together to avoid three-way conflicts.

**Shared contract to agree before coding D:**
- The exact `onPointerDown/Move/Up` prop signatures on `Canvas` (do they carry
  `pointerType`, `pointerId`, `isPrimary`, screen vs world coords?).
- Who owns the container-level Pointer-Events listener (B should).
- The function that returns **screen-space** coordinates for overlay positioning.
- How "this gesture is consumed by the radial menu" is signalled so B's pan and C's
  features stand down for that pointer.
