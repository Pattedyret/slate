# Slate — Package C: Editing & Styling

**Date:** 2026-06-09
**Status:** Design spec — ready for implementation planning
**Package:** C (Editing & styling). Sibling packages: B (zoom/pan viewport), D (other toolbar/board work). See §12 for sequencing.

## 1. Overview

Package C makes Slate objects *editable* and *styleable* after they are drawn. Three
features, all built on the existing object model (`BoardObject { data: JSONB }`) so
every new field is optional and backward-compatible:

1. **Select / move (polish)** — selection + drag + Transformer already exist in
   `select` mode. C improves discoverability and adds the missing operations:
   **delete the selected object** (keyboard + button) and confirms move/resize work
   for every object type. No Transformer redesign.
2. **Full text editing** — replace `window.prompt` with an in-place HTML overlay.
   **Double-tap/double-click** an existing text object to re-edit its words; pick a
   **font family** (curated set); change **font size**; drag to move.
3. **Dashed / dotted styling** — an optional line style for **lines, arrows, rects,
   and ellipses**, picked in the toolbar and editable on a selected object.

The guiding constraint: nothing here breaks two-device sync. All edits flow through the
existing `update()` + `channel.current?.sendCommit()` path (the same last-writer-wins
mechanism as drawing), so styled/edited objects propagate exactly like new ones.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Text editing | **Full**: double-tap to edit words, choose font (curated set), change size, drag to move |
| Text input UI | In-place HTML overlay (replaces `window.prompt`), not a modal |
| Dashing applies to | **line, arrow, rect, ellipse** (NOT freehand pen strokes — see §6.4) |
| Style persistence | Enums (`dash`, `fontFamily`), not raw arrays/CSS strings (§5) |
| Backward-compat | All new fields optional with render-time defaults (JSONB) |

## 3. UX — Select / move / delete

The `select` tool already gives: click/tap to select (attaches `Transformer`), drag to
move (per-type `onDragEnd` reconciles Konva node position back into stored `data`), and
resize handles for `rect`/`ellipse` (`RESIZE_TYPES`). C keeps all of this and adds:

- **Delete the selected object.**
  - **Keyboard:** a global `keydown` listener on `Delete` / `Backspace` deletes the
    currently `selectedId`, then clears selection.
    **Gate (critical):** the listener must *no-op* when a text-edit overlay (or any
    `<input>`/`<textarea>`) is focused — otherwise Backspace deletes the object while the
    user is editing its words. Guard: ignore if
    `document.activeElement` is an `INPUT`/`TEXTAREA` or the edit overlay is open.
  - **Button:** a "delete" button in the toolbar, enabled only when `selectedId` is set.
  - Both call `removeObj(selectedId)` + `channel.current?.sendDelete(selectedId)` and then
    `setSelectedId(null)` (mirrors the eraser path in `BoardView.down`).
- **Move/resize per type (confirm, don't expand):**
  - **Move (drag):** works for *all* types today — keep as-is.
  - **Resize handles:** stay limited to `rect` / `ellipse` (`RESIZE_TYPES`). Lines, arrows,
    strokes, and text are **move-only**; we deliberately do **not** add endpoint handles or
    scale handles (out of scope — "don't redesign the Transformer").
  - **Text size** is changed via the font-size control (§4), not a drag handle.
- **Discoverability:** the selected object already shows the Transformer frame. Add a CSS
  cursor hint (`cursor: move`) on selectable nodes and ensure the delete button's
  enabled/disabled state makes "something is selected" obvious. (Optional, low-risk.)

> **Coordinate dependency (package B):** selection hit-testing and drag math assume the
> Stage pointer coords equal world coords. Today that holds (no Stage transform). Under B's
> zoom/pan, pointer coords must be mapped through the inverse viewport transform.
> **Coordinate-correctness is B's job**; C only flags that selection/drag must keep working
> once B lands.

## 4. UX — Text editing

### 4.1 Create
- With the `text` tool, **tapping the canvas** opens an empty edit overlay at that point
  (replaces `window.prompt`). The overlay is a positioned HTML element over the canvas.
- **Empty on commit → create nothing** (no zero-length text objects).

### 4.2 Re-edit
- In `select` mode, **double-click / double-tap** an existing `text` object opens the
  overlay pre-filled with its current text, positioned over the object. Konva fires
  `onDblClick` / `onDblTap`; wire these on the `<Text>` node.
- **Edited to empty → delete the object** (same delete path as §3).

### 4.3 Overlay behavior
- Element: **`<textarea>`** (not `<input>`). Rationale: text labels may wrap to multiple
  lines; a textarea supports that and matches Konva `<Text>` multiline rendering. The
  locked decision does not fix single vs multiline, so we choose multiline-capable.
- **Commit:** on **blur**, on **Esc** (cancel — revert, no write), and on **Cmd/Ctrl+Enter**
  (commit). Plain **Enter inserts a newline** (because textarea). Commit on blur is the
  primary path and matches "commit on blur/Enter" intent while preserving multiline.
- Styling: the textarea is rendered with the *same* font family / size / color as the
  target object so editing looks WYSIWYG.
- On commit, route through the existing path:
  - New text → `commit(o)` + `sendCommit(o)` (like the current `text` branch).
  - Re-edit → `onTransform(id, { text })` which already does `update()` + `sendCommit()`.

### 4.4 Overlay placement (depends on package B)
- The overlay's *screen* position = the canvas element's `getBoundingClientRect()` offset
  **plus** the object's world→screen position.
- **Even today**, world coords ≠ page coords: the Stage sits below the ~88px top chrome
  (`size.h = window.innerHeight - 88`) and the TabBar/Toolbar. So placement must add the
  canvas bounding-rect offset, not just use raw `data.x/y`.
- **Route through a `worldToScreen(x, y)` helper that package B will own.** Today it is
  identity-plus-canvas-offset; under B it also applies pan/scale. **C does not implement the
  viewport math** — it consumes B's helper (or a temporary identity shim until B lands).

### 4.5 Font family + size
- Add **`fontFamily`** to `TextData` as an enum key (§5), mapped at render time to a CSS
  font stack. Curated set (§4.6).
- Font size uses a **dedicated `fontSize`** (12–96), **separate** from the existing
  `size` slider (1–24, which is stroke width). Conflating them is a trap.
- **Toolbar controls** (font family dropdown + font-size control) are visible when:
  - the `text` tool is active (sets defaults for the *next* text object), **or**
  - a `text` object is **selected** (edits *that* object live).

  This is the **dual-binding** rule (§7): the same control either seeds new-object defaults
  or live-edits the selected object via `onTransform(id, { fontFamily })` /
  `onTransform(id, { fontSize })`.

### 4.6 Curated font set + web-font loading
Persist a small enum; map to a CSS stack at render:

| key | role | CSS stack (render mapping) |
|---|---|---|
| `sans` (default) | system sans | `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` |
| `serif` | serif | `Georgia, 'Times New Roman', serif` |
| `mono` | monospace | `'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace` |
| `marker` | handwriting/marker | `'Permanent Marker', 'Comic Sans MS', cursive` |

- `sans` / `serif` / `mono` resolve to **system / generic** families — no web font needed.
- `marker` needs a real web font (`Permanent Marker`) for a consistent look across devices;
  `mono`'s `JetBrains Mono` is a nice-to-have web font (falls back to system mono cleanly).
- **Konva web-font gotcha (critical):** Konva paints text to a canvas bitmap. If a web font
  is not loaded *before* the first paint, Konva draws the fallback and **never reflows** when
  the font arrives. Mitigation: after fonts load, force a redraw —
  `document.fonts.ready.then(() => layerRef.current?.batchDraw())`, and/or
  `document.fonts.load("16px 'Permanent Marker'")` before using `marker`.
- **Loading strategy — recommend self-hosting** the one or two web fonts as `woff2` in
  `public/fonts/` with a `@font-face` rule. Rationale: Slate is a **PWA on GitHub Pages**
  with a non-root base path; self-hosting keeps fonts available offline and avoids a
  cross-origin Google Fonts `<link>` dependency. (A Google Fonts `<link>` is the simpler
  alternative but breaks offline and adds a third-party request — see open questions.)

## 5. Data-model additions (`src/lib/types.ts`)

All additions are **optional** and rendered with defaults, so existing rows (no field)
keep working — JSONB tolerates missing keys and the round-trip stays clean.

```ts
// New shared enums
export type DashStyle = 'solid' | 'dashed' | 'dotted'
export type FontFamilyKey = 'sans' | 'serif' | 'mono' | 'marker'

export interface SegData  { x1: number; y1: number; x2: number; y2: number; color: string; size: number;
                            dash?: DashStyle }   // line | arrow
export interface RectData { x: number; y: number; w: number; h: number; color: string; size: number;
                            dash?: DashStyle }   // rect | ellipse
export interface TextData { x: number; y: number; text: string; color: string; fontSize: number;
                            fontFamily?: FontFamilyKey }
```

**Render-time defaults (the backward-compat contract):**

| field | default when absent |
|---|---|
| `SegData.dash` / `RectData.dash` | `'solid'` → Konva `dash` **undefined** (a solid stroke), NOT `[]` |
| `TextData.fontFamily` | `'sans'` |
| `TextData.fontSize` | unchanged (already required; existing default 20) |

`StrokeData` is **unchanged** — freehand strokes are not dashable (§6.4).

## 6. UX — Line / shape styling (dash)

### 6.1 Picker
- A **line-style picker** in the toolbar with three options: solid / dashed / dotted.
- Visible when:
  - a dashable tool (`line`, `arrow`, `rect`, `ellipse`) is active → sets the *next*
    object's `dash`, **or**
  - a dashable object is **selected** → live-edits it via `onTransform(id, { dash })`
    (dual-binding, §7).

### 6.2 Enum → Konva mapping (scales with stroke width)
For "best possible" appearance, scale the dash pattern with `strokeWidth` (`d.size`) and
use round caps so dotted renders as true dots:

| `dash` | Konva props |
|---|---|
| `'solid'` | `dash={undefined}` (omit the prop) |
| `'dashed'` | `dash={[3 * size, 2 * size]}` (≈ proportional `[10,6]` at size 4) |
| `'dotted'` | `dash={[0.1 * size, 2.5 * size]}`, `lineCap="round"`, `lineJoin="round"` — a near-zero on-segment with round caps draws circular dots spaced by width |

Scaling keeps dashes readable for both 1px hairlines and 24px strokes (a fixed `[10,6]`
looks like a solid line at width 24 and like Morse code at width 1). Concrete defaults
above; tune during implementation against real rendering.

### 6.3 Storage
Store the **enum** (`dash: 'dashed'`), not the array. Mapping to the Konva array happens at
render. This keeps the JSONB compact and the UI a 3-way toggle (better UX than raw arrays).

### 6.4 Freehand strokes are excluded — and why
Pen strokes render as a **filled, closed `<Line>`** built by `strokeOutline(d.points, size)`
(perfect-freehand outline → polygon `fill`), not as a stroked path. There is no stroke to
dash. So `StrokeData` gains no `dash` field and the picker is hidden for the `pen` tool.

## 7. Component / file changes

> C edits the **same three files as B and D** (`Canvas.tsx`, `BoardView.tsx`, `Toolbar.tsx`).
> Coordinate before parallelizing (§12).

### 7.1 `src/lib/types.ts`
- Add `DashStyle`, `FontFamilyKey`; add `dash?` to `SegData`/`RectData`; add `fontFamily?`
  to `TextData`. (§5.) Optionally export a `FONT_STACKS: Record<FontFamilyKey,string>` and
  `dashArray(style, size)` helper here or in a small `src/lib/style.ts` for reuse by Canvas
  and the overlay.

### 7.2 `src/board/Canvas.tsx`
- **Line/Arrow:** read `d.dash`, pass `dash={dashArray(d.dash, d.size)}` and, for dotted,
  `lineCap="round" lineJoin="round"`. (`line` already sets `lineCap="round"`.)
- **Rect/Ellipse:** same — add `dash={dashArray(d.dash, d.size)}`.
- **Text:** read `d.fontFamily`, pass `fontFamily={FONT_STACKS[d.fontFamily ?? 'sans']}`;
  add `onDblClick`/`onDblTap` → `onSelect?.(o.id)` plus an `onEditText?.(o.id)` callback so
  BoardView opens the overlay. (New optional prop `onEditText?: (id: string) => void`.)
- **Web-font reflow:** in an effect, `document.fonts.ready.then(() => layerRef.current?.batchDraw())`.
- **Transformer:** unchanged (`RESIZE_TYPES` stays rect/ellipse).
- No change to the world-coordinate assumptions here — B owns that.

### 7.3 `src/board/BoardView.tsx`
- **`base()`** — unchanged signature; new objects simply include the new fields in `data`
  (e.g. `base('text', { x, y, text, color, fontSize: t.fontSize, fontFamily: t.fontFamily })`
  and shapes include `dash: t.dash` via `shapeData`).
- **`shapeData()`** — thread `dash` into the returned `SegData`/`RectData`.
- **Text creation** — `down()` `text` branch no longer calls `window.prompt`; instead it
  sets editor state `{ mode:'create', x, y }` to open the overlay. Commit creates the object.
- **Text overlay component** — a new `<TextEditOverlay>` (DOM, not Konva), positioned via
  `worldToScreen()` (§4.4), rendering a `<textarea>` styled to match the target.
  Commit/cancel rules per §4.3.
- **Re-edit wiring** — pass `onEditText={(id)=>openEditor(id)}` to `Canvas`.
- **Delete** — global `keydown` listener (gated per §3) + a delete handler shared with the
  toolbar button; both call `removeObj` + `sendDelete` + `setSelectedId(null)`.
- **Toolbar context flags** — compute `selectedType = objects.find(o=>o.id===selectedId)?.type`
  and pass to Toolbar: `showLineStyle`, `showFontControls`, `hasSelection`. BoardView is the
  only place that knows both `tool` and the selected object's type.

### 7.4 `src/board/useTool.ts`
- Add state: `dash: DashStyle` (default `'solid'`), `setDash`; `fontFamily: FontFamilyKey`
  (default `'sans'`), `setFontFamily`; `fontSize: number` (default `20`), `setFontSize`.
  Keep these **separate** from `size` (stroke width).

### 7.5 `src/board/Toolbar.tsx`
- New props (enumerated): `dash`, `setDash`; `fontFamily`, `setFontFamily`;
  `fontSize`, `setFontSize`; context flags `showLineStyle`, `showFontControls`,
  `hasSelection`; and `onDelete`.
- Render a **line-style toggle** (solid/dashed/dotted) when `showLineStyle`.
- Render a **font dropdown + font-size control** when `showFontControls`.
- Render a **delete button** disabled unless `hasSelection`.
- **Dual-binding** is realized by BoardView: when a matching object is selected, the
  setter callbacks passed to Toolbar both update `useTool` *and* fire `onTransform` on the
  selected object (or BoardView wraps the setters to do both). State this wiring explicitly
  so the same widget edits the selection live and seeds new-object defaults.

## 8. Edge cases

- **Backspace while editing text** deletes the object → guarded by the `activeElement` /
  overlay-open check (§3).
- **Empty text:** create → no object; re-edit to empty → delete (§4.1–4.2).
- **Esc** cancels an edit with no write; **blur** commits.
- **Legacy objects** without `dash` / `fontFamily` render as solid / `sans` (§5).
- **Solid must omit `dash`** (undefined), not pass `[]` — `[]` can render oddly.
- **Dash at width 1 vs 24** — handled by width-scaling (§6.2).
- **Web font not yet loaded** when a `marker` text first paints → fallback then reflow via
  `document.fonts.ready` (§4.6).
- **Selection cleared on tool change** already handled (`useEffect` on `t.tool`); ensure the
  edit overlay also closes when switching tools/boards.
- **Live remote edit of the object being edited locally** — last-writer-wins on commit; if a
  remote `sendCommit` arrives mid-edit, the local blur-commit will overwrite it (acceptable
  for 1–2 users, consistent with the existing conflict model). Note, don't solve.
- **Overlay during pan/zoom (B):** if the viewport moves while editing, the overlay should
  reposition (recompute `worldToScreen`) or close — flag for B integration.
- **Font size on a non-text selection / dash on a text selection** — controls are hidden by
  the context flags so this can't happen.

## 9. Testing

### 9.1 Unit — extend `tests/types.test.ts` (Vitest)
- Add a round-trip for a **dashed line**: `SegData` with `dash: 'dashed'` survives
  `JSON.parse(JSON.stringify(o))`.
- Add a round-trip for **styled text**: `TextData` with `fontFamily: 'marker'`.
- Add a **legacy** object (no `dash` / `fontFamily`) and assert it round-trips unchanged
  (proves optional fields are backward-compatible). Optionally assert the default helpers:
  `dashArray('solid', 4) === undefined`, `FONT_STACKS['sans']` defined.

### 9.2 E2E — new `*.spec.ts` (Playwright, mirror `draw-sync.spec.ts`)
Same harness: a Supabase observer client creates the account + board so `boardId` is known,
the browser signs into the same account, performs the action, and we assert the **persisted
`data` JSONB** read back from Postgres.

- **`create-dashed-shape.spec.ts`** — select the `rect` (or `line`) tool, set the line-style
  picker to **dashed**, drag a shape on the canvas, then
  `expect.poll` on `observer.from('objects').select('type,data')` until a row exists with
  `data.dash === 'dashed'`.
- **`edit-text.spec.ts`** — select the `text` tool, click the canvas (overlay opens — the DOM
  textarea is actually *easier* to drive than the old `window.prompt`), type text, optionally
  pick a font, blur/commit, then poll Postgres for a `text` row with the expected `data.text`
  (and `data.fontFamily` if set). Optionally re-select and double-click to re-edit and assert
  the updated text persists.

Note: `playwright.config.ts` already loads `.env` and serves on `:5179` under `/slate/`; new
specs need no config change. Unit/e2e split is enforced by `testMatch`/Vitest include.

### 9.3 Manual
- Two-device: edit text / change dash on one device, confirm it updates live on another.
- Touch: double-tap to edit on a phone; confirm the overlay is reachable and dismissible.

## 10. Scope

**In C:** delete selected (key + button); confirm move/resize per type; in-place text
create + re-edit with font family + font size + drag; dashed/dotted for line/arrow/rect/
ellipse; toolbar controls (line style, font family, font size, delete) with dual-binding;
data-model fields + defaults; tests.

**Out of C:** Transformer redesign / endpoint handles / line resize; rotation; per-character
text styling / rich text; dashing freehand strokes; the viewport (zoom/pan) math (package B);
text alignment / background boxes.

## 11. Data migration

None required. All new fields are **optional** on the JSONB `data` column. Existing rows have
no `dash` / `fontFamily`; they render with defaults (`solid`, `sans`) via the helpers in §5.
No SQL migration, no backfill. New writes simply include the fields.

## 12. Cross-package coupling & sequencing

- **C depends on package B (zoom/pan viewport).** Two touch points:
  1. **Text-edit overlay placement** needs a `worldToScreen()` mapping (canvas offset today;
     pan/scale once B lands). C consumes B's helper; **C does not implement viewport math.**
  2. **Selection + drag hit-testing** assumes pointer coords == world coords; under B's
     transform they must be inverse-mapped. Coordinate-correctness is **B's responsibility**.
  → **Land C after B**, or land C against a temporary identity `worldToScreen` shim and
    re-point it at B's helper when B merges.
- **C edits the same three files as B and D:** `src/board/Canvas.tsx`,
  `src/board/BoardView.tsx`, `src/board/Toolbar.tsx`. These changes **must be coordinated**
  (shared Props growth, the render loop in Canvas, the toolbar layout) and **not run blindly
  in parallel** — merge conflicts and prop-shape drift are likely. Recommended order:
  **B (viewport) → C (this package) → D**, or a single coordinated branch with explicit
  ownership of each file region.

## 13. Open questions

1. **Web fonts:** self-host `woff2` (offline-friendly, recommended) vs Google Fonts `<link>`
   (simpler)? And exactly which faces for `mono` / `marker`?
2. **Curated set:** are 4 families (`sans`/`serif`/`mono`/`marker`) the right set, or do you
   want a 5th (e.g. a rounded display face)?
3. **Text commit key:** confirm Enter = newline + Cmd/Ctrl+Enter/blur = commit (multiline), vs
   Enter = commit (single-line `<input>`).
4. **Dotted look:** confirm round-cap dots vs short dashes for `'dotted'`.
5. **Dual-binding scope:** should changing the toolbar color/size while an object is selected
   also live-edit it (consistency), or is live-edit limited to the new dash/font controls?
6. **Re-edit gesture on touch:** double-tap is the plan; acceptable, or prefer a long-press /
   an "edit" affordance on the Transformer?
