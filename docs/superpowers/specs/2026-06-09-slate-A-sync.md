# Slate — Package A: Finish Live Sync (undo / redo / clear)

**Date:** 2026-06-09
**Status:** Design spec — ready for implementation planning
**Package:** A (of A/B/C/D) — independent; can ship first.

## 1. Overview

Today, three of Slate's state changes do **not** propagate live across devices:

- **Undo** and **Redo** — `useBoardObjects.undo` / `redo` (src/board/useBoardObjects.ts:73-83)
  mutate the local history reducer and write the resulting diff to Postgres via `persistDiff`,
  but never broadcast. Other devices only catch up on the next board reload.
- **Clear board** — `useBoardObjects.clear` (src/board/useBoardObjects.ts:67-71) resets the local
  view to `{}` and soft-deletes every row via `clearBoard`, but never broadcasts.

Drawing, shape commits, transforms, and erases already broadcast correctly — they call
`channel.current?.sendCommit(...)` / `sendDelete(...)` from `BoardView` (src/board/BoardView.tsx:52,
59-61, 85, 99) paired with their DB write. Package A brings undo/redo/clear to the same standard:
the already-committed state change is broadcast on the per-board channel so every other live device
updates within a fraction of a second, with no reload.

This package adds **broadcast only** for state changes that are *already persisted*. It does not
touch the pen/eraser/pointer input path, does not change the "no per-point DB writes" rule, and adds
no new database writes (undo/redo/clear already write to Postgres today).

**Locked decision (carried from the parent task):** undo reverts only the user's **own** edits via
the existing local history-stack model. Remote changes must never enter the local undo stack. This
package preserves that: the receive path is unchanged and continues to apply remote changes through
the reducer's `sync` action, which replaces `present` while leaving `past` / `future` untouched
(src/lib/history.ts:31-32).

## 2. Behavior

### Undo / Redo (originator)
1. User clicks undo/redo. `useBoardObjects.undo` / `redo` computes `next` by running the pure
   `historyReducer` against `histRef.current` (the freshest committed state — src/board/useBoardObjects.ts:10-12, 74, 80).
2. The `before → after` diff (`histRef.current.present` → `next.present`) is computed **once** and used to drive **both**:
   - **Postgres** — `saveObject` for objects now present/changed, `softDeleteObject` for objects now absent (existing `persistDiff` behavior).
   - **Broadcast** — `sendCommit` for each object now present/changed, `sendDelete` for each object now absent.
3. The local reducer is then dispatched (`undo` / `redo`) to advance `past` / `present` / `future`.
4. Remote devices receive the `commit` / `delete` events and apply them through their existing
   `onCommit` / `onDelete` handlers (src/board/useBoardObjects.ts:29-37). **No remote-side change is required.**

Because `self: false` is set on the channel (src/lib/realtime.ts:19), the originating device never
receives its own broadcast, so there is no echo loop.

### Undo of a delete (restore)
When a user undoes an erase, the restored object reappears for remote devices. This works for free:
`remove` deletes the *key* from the present map (src/lib/history.ts:25-27), so the prior snapshot in
`past` still holds the object with its original `deleted: false`. The diff yields
`before[id] = undefined, after[id] = object` → `a && a !== b` → `sendCommit(object)`. The receiver's
`onCommit` sets `present[id] = object`, and `Canvas` renders it (it filters on `!o.deleted`). No special-casing needed.

### Clear board (originator)
1. User clicks clear. `useBoardObjects.clear` resets the local view (`dispatch({ kind: 'reset', objects: {} })`)
   and soft-deletes all rows via `clearBoard` (existing behavior).
2. **New:** it also broadcasts a single dedicated `clear` event over the channel.
3. Remote devices receive `clear` and reset their *present* to `{}` (see §3 for the exact dispatch and §5 for the open question on `sync` vs `reset`), and drop any in-flight `liveDrafts`.

### Clear board (remote receiver)
On `clear`, the receiver replaces `present` with `{}` via the reducer's **`sync`** action (not `reset`)
and clears `liveDrafts`. `sync` leaves the remote user's `past` / `future` intact — consistent with
how every other remote change is applied, and faithful to the locked decision that remote changes
must not perturb the local undo stack. (See §5 for the UX consequence and the user question.)

## 3. Exact changes per file / function

All cited symbols are verified against the current source.

### 3.1 `src/lib/realtime.ts` — add a `clear` event to the channel

**`BoardChannel` interface (src/lib/realtime.ts:4-9)** — add:
```ts
sendClear: () => void
```

**`joinBoard` handlers param (src/lib/realtime.ts:11-18)** — add:
```ts
onClear: () => void
```

**Subscription wiring (src/lib/realtime.ts:20-24)** — add one `.on`:
```ts
.on('broadcast', { event: 'clear' }, () => handlers.onClear())
```

**Returned channel object (src/lib/realtime.ts:27-32)** — add:
```ts
sendClear: () => send('clear', {}),
```
(The `clear` payload carries no data — it is a board-wide reset signal. An empty object keeps the
`send(event, payload)` signature uniform.)

No change to `sendPoints` / `sendCommit` / `sendDelete` / `live` / `commit` / `delete`.

### 3.2 `src/board/useBoardObjects.ts` — broadcast undo/redo/clear; handle remote clear

**(a) Factor the diff out of `persistDiff` (src/board/useBoardObjects.ts:43-50) — DRY.**
`persistDiff` currently inlines both the diff computation and the DB write. Extract a pure diff so
DB writes *and* broadcasts derive from the **same** before/after, staying consistent by construction:

```ts
// Pure: classify a before→after change into commits (added/changed) and deletes (removed).
const diffObjects = (before: ObjectMap, after: ObjectMap) => {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)])
  const commits: BoardObject[] = []
  const deletes: string[] = []
  ids.forEach(id => {
    const b = before[id], a = after[id]
    if (a && a !== b) commits.push(a)        // added or changed
    else if (b && !a) deletes.push(id)       // removed
  })
  return { commits, deletes }
}

const persistDiff = (before: ObjectMap, after: ObjectMap) => {
  const { commits, deletes } = diffObjects(before, after)
  commits.forEach(o => saveObject(o).catch(console.error))
  deletes.forEach(id => softDeleteObject(id).catch(console.error))
}

const broadcastDiff = (before: ObjectMap, after: ObjectMap) => {
  const { commits, deletes } = diffObjects(before, after)
  commits.forEach(o => chan.current?.sendCommit(o))
  deletes.forEach(id => chan.current?.sendDelete(id))
}
```

**(b) `undo` (src/board/useBoardObjects.ts:73-77)** — broadcast the same diff it persists:
```ts
const undo = useCallback(() => {
  const next = historyReducer(histRef.current, { kind: 'undo' })
  persistDiff(histRef.current.present, next.present)
  broadcastDiff(histRef.current.present, next.present)   // NEW
  dispatch({ kind: 'undo' })
}, [])
```

**(c) `redo` (src/board/useBoardObjects.ts:79-83)** — symmetric:
```ts
const redo = useCallback(() => {
  const next = historyReducer(histRef.current, { kind: 'redo' })
  persistDiff(histRef.current.present, next.present)
  broadcastDiff(histRef.current.present, next.present)   // NEW
  dispatch({ kind: 'redo' })
}, [])
```
Note: if there is nothing to undo/redo, `historyReducer` returns the same state (src/lib/history.ts:34, 39),
so `next.present === histRef.current.present`, the diff is empty, and nothing is persisted or broadcast.
No guard needed.

**(d) `clear` (src/board/useBoardObjects.ts:67-71)** — broadcast a single `clear`:
```ts
const clear = useCallback(() => {
  if (!boardId) return
  dispatch({ kind: 'reset', objects: {} })
  clearBoard(boardId).catch(console.error)
  chan.current?.sendClear()                              // NEW
}, [boardId])
```
The local originator keeps `reset` (wipes its own undo history — clear is intentionally not locally
undoable, consistent with today's behavior).

**(e) Remote `onClear` handler — add to the `joinBoard` call (src/board/useBoardObjects.ts:27-38):**
```ts
chan.current = joinBoard(boardId, {
  onLive: ...,      // unchanged
  onCommit: ...,    // unchanged
  onDelete: ...,    // unchanged
  onClear: () => {                                        // NEW
    setLiveDrafts({})                                     // drop any in-flight remote points
    dispatch({ kind: 'sync', objects: {} })               // replace present; keep past/future
  },
})
```
`sync` (src/lib/history.ts:31-32) is deliberate: it does not touch the remote user's `past` / `future`,
matching how `onCommit` / `onDelete` already apply remote changes and honoring the locked
"remote changes don't enter the undo stack" rule.

### 3.3 `src/board/BoardView.tsx` — no changes

`BoardView` calls `undo` / `redo` / `clear` as opaque callbacks (src/board/BoardView.tsx:110-111).
Because the broadcast lives inside those callbacks in `useBoardObjects`, BoardView needs no edit.
This is the correct seam: undo/redo/clear are **not** pointer-driven (unlike draw/erase, which
broadcast from BoardView because they originate in pointer handlers), so their broadcast belongs in
the hook that owns the history + channel.

### 3.4 `src/lib/history.ts` — no changes

The reducer already exposes everything needed: `sync` for non-undoable remote application, and
`undo` / `redo` for the local stack. The remote receive path is unchanged.

## 4. Edge cases

1. **Rapid undo/redo (histRef freshness).** `histRef` is refreshed in a `useEffect`
   (src/board/useBoardObjects.ts:10-12), so two synchronous clicks both read the same base
   `present`. **This is pre-existing** — `persistDiff` already has this characteristic on the DB
   path; broadcasting inherits it and does not create it. It is benign here precisely *because* the
   broadcast derives from the **same** `histRef.current.present` → `next.present` pair that the DB
   write uses, so the channel and the DB never diverge. (Flagged per No-Blind-Eye; no fix required,
   but noted for the implementer.)

2. **Undo of a delete.** Covered in §2 — re-broadcasts the restored object as a `commit` with its
   original `deleted: false`; receiver renders it. No special-casing.

3. **Clear arriving mid-draft on another device.** A device drawing when `clear` arrives keeps its
   local `draft.current` (a BoardView ref, untouched by this package) and will `commit` that one
   stroke on pointer-up, so it reappears. This is acceptable under the last-writer-wins conflict
   model (design §8 — CRDT is explicitly YAGNI) and is documented as a known limitation, not
   engineered around. `onClear` **does** clear `liveDrafts`, so in-flight *remote* points already
   received are dropped immediately.

4. **Clear does not echo.** `self: false` (src/lib/realtime.ts:19) means the originating device does
   not receive its own `clear`; it already reset locally in step 1.

5. **Empty undo/redo.** No-op diff (see §3.2c note) → no broadcast, no DB write.

6. **Eraser interplay.** Erase already broadcasts a `delete` from BoardView. Undoing that erase
   re-broadcasts a `commit` (case 2). Redoing it re-broadcasts a `delete`. Consistent both ways.

## 5. Open question for the user (UX-visible)

**Remote-clear semantics — `sync` vs `reset` on the receiver.** This spec recommends **`sync`** so a
remote user's own `past` / `future` survive a clear broadcast (faithful to the locked rule that
remote changes don't perturb the local undo stack).

**The consequence, stated precisely.** `sync({})` replaces remote user B's `present` with `{}` but
leaves B's `past` intact. If B then presses undo, the reducer pops B's last `past` snapshot — e.g.
`{obj1, obj2, obj3}` — back into `present`, and `broadcastDiff({}, {obj1, obj2, obj3})` re-sends a
`commit` for **every object in that snapshot** to all devices. So a single undo after a remote clear
can resurrect **B's entire prior board state** and re-broadcast it everywhere — not merely one
object. Under last-writer-wins (no CRDT, design §8) this is unavoidable and is documented as a known
limitation.

`sync` is nonetheless the faithful choice: the locked rule is "undo reverts only the user's own
edits," and `sync` keeps B's history intact so B can still undo B's own work. `reset` to `{}` would
destroy B's ability to undo their own prior edits — a larger violation of the locked rule — and is
therefore rejected. **Recommend `sync`; confirm with the user that "undo after a remote clear can
restore the full prior board" is acceptable** as the honest LWW behavior.

(The `reset`-to-`{}` alternative and why it is rejected are covered above.)

## 6. Clear: dedicated event vs N deletes — decision

**Recommended: a dedicated `clear` broadcast event** (`sendClear` / `onClear`), not N `sendDelete`
calls. Reasons:

- **Atomicity under the rate cap (decisive).** `src/lib/supabase.ts:17` sets
  `realtime: { params: { eventsPerSecond: 40 } }`. A board with >40 objects cleared via N deletes
  would exceed the per-second broadcast budget, so messages throttle/drop and remote boards clear
  **partially**. One `clear` message is O(1) and atomic regardless of board size.
- **Originator-agnostic.** A blanket reset does not require the sender to enumerate every id; it
  mirrors the local `reset` exactly.
- **Cheaper receive.** One dispatch vs N `sync` dispatches (each rebuilding the present map).

The N-deletes approach has the narrow appeal of reusing the existing `delete` event with no
realtime.ts change, but the rate-cap failure on large boards rules it out for a board that is meant
to scale to many objects.

## 7. Testing

Extend the existing Playwright e2e at `tests/e2e/draw-sync.spec.ts`, which already uses an
independent Realtime **observer** client that subscribes to `board:${boardId}` before the browser
draws (the established house pattern — tests/e2e/draw-sync.spec.ts:39-55).

**Do not reuse the existing `capture` helper for the new tests.** That helper latches on the *first*
broadcast of any type (`if (!firstEvent)` — tests/e2e/draw-sync.spec.ts:43-48) and ignores all
subsequent events. The undo and clear flows draw first (which fires `live` / `commit` and latches the
single resolver), *then* act (which fires `delete` / `clear`) — so a shared-latch observer would
resolve on the draw's `commit` and never see the later `delete` / `clear`, hanging the test until the
20s timeout.

Instead, collect **all** events into an array and assert membership, e.g.:

```ts
const events: { event: string; payload: any }[] = []
const push = (event: string) => ({ payload }: { payload: any }) => events.push({ event, payload })
channel
  .on('broadcast', { event: 'live' },   push('live'))
  .on('broadcast', { event: 'commit' }, push('commit'))
  .on('broadcast', { event: 'delete' }, push('delete'))   // NEW
  .on('broadcast', { event: 'clear' },  push('clear'))    // NEW
// then assert with expect.poll(() => events.some(e => e.event === 'delete' && e.payload.id === id))
```
(Alternatively, use a distinct promise per event type with its own resolver — no shared `firstEvent`.)

Add two new tests, each following the existing structure (observer subscribes → browser signs in →
acts → assert broadcast + DB):

- **Undo broadcasts.** Draw a pen stroke (reuse the existing draw block); poll until a `commit` is in
  `events` and capture its `payload.id`; click the `undo` toolbar button
  (`page.getByRole('button', { name: 'undo' })`); poll until `events` contains a `delete` whose
  `payload.id` equals that stroke id; poll Postgres until that object's row reads `deleted: true`.
- **Clear broadcasts.** Draw a stroke; click the `clear` button
  (`page.getByRole('button', { name: 'clear' })`); poll until `events` contains a `clear` event; poll
  Postgres until all of the board's rows read `deleted: true` (or `loadObjects` returns 0).

Use the observer (not a second browser context) for the broadcast assertions — it is lighter,
deterministic, and matches the existing file. A fuller two-context test (draw in ctx1, undo, assert
the node disappears in ctx2) would validate the full visual loop and may be added later, but is not
required for this package.

Also run the existing unit suite (`tests/history.test.ts`) unchanged — `history.ts` is not modified,
so it must still pass, confirming the reducer contract this package relies on.

## 8. Cross-package coupling & sequencing

**Package A is independent of packages B / C / D, which rework the pointer/input layer.** A touches
exactly two source files — `src/lib/realtime.ts` (add `clear` event) and
`src/board/useBoardObjects.ts` (broadcast undo/redo/clear; handle remote clear) — plus the e2e test.
It does **not** modify:

- `src/board/BoardView.tsx` (the pointer/draw orchestration B/C/D rework) — see §3.3.
- `src/board/Canvas.tsx`, `src/board/useTool.ts`, or any pointer-event handling.
- `src/lib/history.ts` — the reducer contract is unchanged.

The only shared surface is the `BoardChannel` interface in `realtime.ts`: A **adds** `sendClear` /
`onClear` (purely additive — no existing field changes signature). If B/C/D also extend
`BoardChannel`, the changes are additive and merge cleanly; coordinate only on import ordering if two
packages edit the same interface block.

**Sequencing: A can ship first and independently.** It has no dependency on B/C/D and they have no
dependency on it. Shipping A first lands a user-visible correctness fix (undo/redo/clear now sync)
without waiting on the input-layer rework.
