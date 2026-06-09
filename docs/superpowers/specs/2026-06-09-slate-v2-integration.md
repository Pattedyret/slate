# Slate v2 — Feature Round Integration & Sequencing

**Date:** 2026-06-09
**Status:** Awaiting user approval before implementation planning

This ties together four package specs requested in one round. Each has its own design doc:

- **A — Finish live sync:** [`2026-06-09-slate-A-sync.md`](./2026-06-09-slate-A-sync.md)
- **B — Canvas navigation:** [`2026-06-09-slate-B-navigation.md`](./2026-06-09-slate-B-navigation.md)
- **C — Editing & styling:** [`2026-06-09-slate-C-editing-styling.md`](./2026-06-09-slate-C-editing-styling.md)
- **D — S Pen radial menu:** [`2026-06-09-slate-D-radial-menu.md`](./2026-06-09-slate-D-radial-menu.md)

Plus the already-shipped eraser-hover fix (commit `9258e13`).

## Locked product decisions (from the user)

- Viewport (pan/zoom) is **independent per device** — not synced, not persisted.
- Undo reverts **only your own edits**; the result syncs to others.
- Text editing is **full**: edit content, change font, change size, drag to move.
- The radial menu carries **tools + colors + size**.

## Cross-package architecture decisions (integration-level)

These resolve conflicts/gaps the individual specs left open. **Where a package spec conflicts with this section, this section wins.**

### 1. One unified Pointer-Events input layer (owned by B)
Package B will **not** keep Konva's split `onMouse*`/`onTouch*` handlers. Instead it establishes a single input layer using **Pointer Events** on the Stage container, exposing normalized `onPointerDown/Move/Up(world, {pointerId, pointerType, pointers})`. This one layer serves:
- **Draw / erase** (single primary pointer) — Package C/existing.
- **Pan + pinch-zoom** (two pointers, or wheel) — Package B.
- **Long-press radial menu** (single stationary pointer, `pointerType`-aware) — Package D.

Rationale: D needs `pointerType` (S Pen) and multi-pointer tracking anyway; doing it once in B means C and D extend one pipeline instead of re-migrating. Screen→world conversion happens at exactly this boundary via the Stage transform (`getRelativePointerPosition` / inverse-transform). All stored object coordinates remain **world** coordinates, so cross-device sync is unaffected.

### 2. Coordinate model (owned by B)
Stage carries `scaleX/scaleY = zoom`, `x/y = pan`; objects live in an untransformed layer in world space. Drawing, hit-testing, drag, and resize all operate in world coords (no change to `shapeData`/`near`/drag math). C's text-edit overlay and D's menu are positioned in **screen** space via `worldToScreen(world) = pan + zoom * world`.

### 3. Dynamic canvas sizing (owned by B)
Replace the hardcoded `window.innerHeight - 88` with a measured wrapper (`ResizeObserver` on a `.canvas-wrap`). This is what lets the collapsible menu and fullscreen reflow the canvas. Foundational for everything visual.

### 4. Deferred first broadcast (owned by B, consumed by C/D)
The in-flight `sendPoints` broadcast is deferred until the pointer moves beyond the long-press movement threshold. Prevents ghost strokes on remote devices when a long-press (D) or a stationary tap cancels a draft. This lives in the shared input layer so all packages benefit.

## Build order & file ownership

```
Phase 1 (parallel):
  ┌─ B  (FOUNDATION): unified pointer layer, viewport transform, dynamic sizing,
  │     pan/zoom, fullscreen, collapsible menu, world-space grid
  └─ A  (INDEPENDENT): broadcast undo/redo diffs + clear event
        — touches only realtime.ts, useBoardObjects.ts (+ e2e). No pointer/Canvas overlap.

Phase 2 (after B lands; sequential, shared files):
     C  editing & styling  → then →  D  radial menu
```

**Why A can run beside B:** A touches `src/lib/realtime.ts` and `src/board/useBoardObjects.ts` only; B/C/D touch `Canvas.tsx`, `BoardView.tsx`, `Toolbar.tsx`, `useTool.ts`, `styles.css`. No file overlap → A is safe to parallelize with B.

**Why C and D are sequential, not parallel:** both edit `BoardView.tsx` and `Canvas.tsx` on top of B's new structure. Running them concurrently on the same files collides. Order: **B → C → D** (D's long-press is the most input-entangled, so it goes last on a settled pipeline).

| File | A | B | C | D |
|---|:--:|:--:|:--:|:--:|
| `src/lib/realtime.ts` | ✎ | | | |
| `src/board/useBoardObjects.ts` | ✎ | | | |
| `src/lib/history.ts` | (read) | | | |
| `src/lib/types.ts` | | | ✎ | |
| `src/board/Canvas.tsx` | | ✎ (rewrite input) | ✎ | ✎ |
| `src/board/BoardView.tsx` | | ✎ | ✎ | ✎ |
| `src/board/Toolbar.tsx` | | ✎ | ✎ | (read) |
| `src/board/useTool.ts` | | (read) | ✎ | ✎ |
| `src/styles.css` | | ✎ | ✎ | ✎ |
| new `useViewport.ts`, `useElementSize.ts` | | ✎ | | |
| new `RadialMenu.tsx`, `useLongPress.ts` | | | | ✎ |
| new font files `public/fonts/*` | | | ✎ | |

## Consolidated decisions for the specs' open questions (defaults chosen)

| Pkg | Question | Decision |
|---|---|---|
| A | Remote `clear` then remote undo can restore a full prior snapshot (LWW, no CRDT) | **Accept** — obscure edge case, consistent with the design's last-writer-wins model |
| B | Auto-collapse menu in fullscreen? | **Yes** — fullscreen = maximum canvas |
| B | Zoom limits | **0.1× – 8×** |
| B | Reset behavior | **Reset to 100% at origin** (fit-to-content deferred) |
| B | Zoom % indicator | **Yes**, small, beside the zoom controls |
| B | iOS fullscreen (no Fullscreen API for non-video) | Feature-detect; **hide** the fullscreen button where unsupported; collapsible menu is the "more space" path. (S Pen target is Android/Chrome, where it works.) |
| C | Color/size/style edit a selected object | **Yes** — changing a control updates the current selection |
| C | Text commit | **Multiline** textarea; **Esc** cancels, **blur / Ctrl·Cmd+Enter** commits; empty = no object / delete |
| C | Touch re-edit | **Double-tap** |
| D | Auto-dismiss | Tap outside or pick a tool dismisses; picking color/size keeps it open |
| D | Edge clamp | Clamp the wheel on-screen near edges |
| D | Size control | Stepper across the existing 1–24 range |
| D | Long-press on a selected object | v1: always opens the tool wheel (object context menu deferred) |
| D | Long-press timing | 500 ms, 8 px movement threshold, all pointer types |

## Open questions genuinely worth the user's input

1. **Fonts (C):** proposed curated set = **system sans**, **serif**, **monospace** (JetBrains Mono), **handwriting/marker** (Permanent Marker). The two non-system faces are self-hosted `woff2` in `public/fonts/`. Confirm the set / swap faces.
2. **Fullscreen auto-collapse (B):** confirm fullscreen should also hide the top menu (vs keep it).

## Testing strategy

- **A:** extend `tests/e2e/draw-sync.spec.ts` realtime-observer to assert `delete`/`clear` broadcasts + DB state (collect events in an array — do **not** reuse the single-event latch).
- **B:** e2e — stage transform changes on wheel/gesture; a stroke drawn while zoomed+panned persists at correct **world** coords and reloads in the right place; menu toggle; fullscreen state.
- **C:** extend `tests/types.test.ts` round-trip for `dash` + `fontFamily` (incl. a legacy object without them); e2e create-dashed-shape + edit-text.
- **D:** e2e simulate a stationary long-press → menu appears → pick a sector → active tool changes; **regression test**: long-press then cancel leaves **no** ghost stroke on a second device.

## Definition of done (whole round)

All four packages merged to `main`, `npx tsc` + `npx vitest run` + `npx playwright test` green, deployed to GitHub Pages, and smoke-tested live on a touch/stylus device for the gesture + radial-menu paths.
