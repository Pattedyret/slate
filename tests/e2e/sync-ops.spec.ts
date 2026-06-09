import { test, expect, type Page, type Locator } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// `RealtimeChannel` is not re-exported from `@supabase/supabase-js`'s entry types, so derive the
// channel type from `SupabaseClient.channel` (which is exported) to keep the helper signature typed.
type Channel = ReturnType<SupabaseClient['channel']>

// Package A: undo and clear must propagate live across devices, not just on reload.
//
// These complement draw-sync.spec.ts (which asserts the draw → live/commit path). Here we
// assert the two remaining operations that previously stayed local:
//   • Undo of a stroke  → observer receives a `delete` for that stroke + the DB row is soft-deleted.
//   • Clear the board   → observer receives a `clear` + every board row is soft-deleted.
//
// House pattern (matches draw-sync): an independent Realtime "observer" subscribes to the board
// channel BEFORE the browser draws, removing the subscribe/draw race. Crucially the observer here
// collects ALL events into an ARRAY (not draw-sync's single-event latch): the flows draw first
// (firing live/commit) and only THEN act (firing delete/clear), so a first-event latch would
// resolve on the draw's commit and never see the later delete/clear — hanging until timeout.

const url = process.env.VITE_SUPABASE_URL!
const key = process.env.VITE_SUPABASE_ANON_KEY!
const rnd = () => `slate-ops-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
const PW = 'password123'

interface Captured { event: string; payload: any }

// Subscribe an observer that pushes every broadcast into `events`, and resolve once SUBSCRIBED.
async function joinObserver(observer: SupabaseClient, boardId: string, events: Captured[]): Promise<Channel> {
  const channel = observer.channel(`board:${boardId}`, { config: { broadcast: { self: false } } })
  const push = (event: string) => ({ payload }: { payload: any }) => events.push({ event, payload })
  channel
    .on('broadcast', { event: 'live' },   push('live'))
    .on('broadcast', { event: 'commit' }, push('commit'))
    .on('broadcast', { event: 'delete' }, push('delete'))
    .on('broadcast', { event: 'clear' },  push('clear'))
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`channel: ${status}`))
    })
  })
  return channel
}

// Sign the browser into `email` and land on the board (toolbar + canvas visible). Returns the canvas.
async function signInAndOpenBoard(page: Page, email: string) {
  await page.goto('./')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(PW)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'pen' })).toBeVisible()
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  // Give the app's own channel a moment to finish subscribing before we draw.
  await page.waitForTimeout(2000)
  return canvas
}

// Draw a pen stroke (pen is the default tool). Returns nothing — the stroke id is read from the
// observer's `commit` event, and persistence is confirmed via the DB poll below.
async function drawStroke(page: Page, canvas: Locator) {
  const box = await canvas.boundingBox()
  expect(box).toBeTruthy()
  const x0 = box!.x + box!.width * 0.3
  const y0 = box!.y + box!.height * 0.4
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 + i * 14, y0 + i * 8)
    await page.waitForTimeout(40) // exceed the 33ms throttle so live points emit
  }
  await page.mouse.up()
}

test('undo of a stroke is broadcast as a delete and soft-deletes the DB row', async ({ page }) => {
  expect(url, 'VITE_SUPABASE_URL must be set').toBeTruthy()
  expect(key, 'VITE_SUPABASE_ANON_KEY must be set').toBeTruthy()

  const email = rnd()
  const observer = createClient(url, key)
  const { data: sign, error: signErr } = await observer.auth.signUp({ email, password: PW })
  expect(signErr, signErr?.message).toBeNull()
  expect(sign.session).toBeTruthy()
  const uid = sign.user!.id
  const { data: board, error: boardErr } = await observer.from('boards')
    .insert({ owner_id: uid, title: 'Ops-undo', sort_order: 0 })
    .select().single()
  expect(boardErr, boardErr?.message).toBeNull()
  const boardId = board!.id

  const events: Captured[] = []
  const channel = await joinObserver(observer, boardId, events)

  const canvas = await signInAndOpenBoard(page, email)
  await drawStroke(page, canvas)

  // The stroke must commit (live broadcast + DB upsert). Capture its id from the commit event.
  await expect.poll(() => events.some(e => e.event === 'commit'),
    { timeout: 20_000, message: 'stroke should broadcast a commit' }).toBe(true)
  const strokeId = events.find(e => e.event === 'commit')!.payload.id as string
  expect(strokeId).toBeTruthy()

  // Race guard: wait until the stroke row actually exists (deleted:false) BEFORE undoing, so the
  // undo's softDelete cannot lose to the commit's upsert (which would re-write deleted:false).
  await expect.poll(async () => {
    const { data } = await observer.from('objects').select('id,deleted').eq('id', strokeId).maybeSingle()
    return data?.deleted === false
  }, { timeout: 15_000, message: 'stroke should be persisted as not-deleted before undo' }).toBe(true)

  // Undo the stroke.
  await page.getByRole('button', { name: 'undo' }).click()

  // Observer must receive a `delete` for that exact stroke id.
  await expect.poll(() => events.some(e => e.event === 'delete' && e.payload.id === strokeId),
    { timeout: 15_000, message: 'undo should broadcast a delete for the stroke' }).toBe(true)

  // And the DB row must now be soft-deleted.
  await expect.poll(async () => {
    const { data } = await observer.from('objects').select('deleted').eq('id', strokeId).maybeSingle()
    return data?.deleted === true
  }, { timeout: 15_000, message: 'undo should soft-delete the stroke row' }).toBe(true)

  await observer.removeChannel(channel)
})

test('clear is broadcast as a clear event and soft-deletes every board row', async ({ page }) => {
  expect(url, 'VITE_SUPABASE_URL must be set').toBeTruthy()
  expect(key, 'VITE_SUPABASE_ANON_KEY must be set').toBeTruthy()

  const email = rnd()
  const observer = createClient(url, key)
  const { data: sign, error: signErr } = await observer.auth.signUp({ email, password: PW })
  expect(signErr, signErr?.message).toBeNull()
  expect(sign.session).toBeTruthy()
  const uid = sign.user!.id
  const { data: board, error: boardErr } = await observer.from('boards')
    .insert({ owner_id: uid, title: 'Ops-clear', sort_order: 0 })
    .select().single()
  expect(boardErr, boardErr?.message).toBeNull()
  const boardId = board!.id

  const events: Captured[] = []
  const channel = await joinObserver(observer, boardId, events)

  const canvas = await signInAndOpenBoard(page, email)
  await drawStroke(page, canvas)

  // The stroke must commit; capture its id and confirm it is persisted before clearing (race guard).
  await expect.poll(() => events.some(e => e.event === 'commit'),
    { timeout: 20_000, message: 'stroke should broadcast a commit' }).toBe(true)
  const strokeId = events.find(e => e.event === 'commit')!.payload.id as string
  await expect.poll(async () => {
    const { data } = await observer.from('objects').select('id,deleted').eq('id', strokeId).maybeSingle()
    return data?.deleted === false
  }, { timeout: 15_000, message: 'stroke should be persisted as not-deleted before clear' }).toBe(true)

  // Clear the board.
  await page.getByRole('button', { name: 'clear' }).click()

  // Observer must receive a `clear` event.
  await expect.poll(() => events.some(e => e.event === 'clear'),
    { timeout: 15_000, message: 'clear should broadcast a clear event' }).toBe(true)

  // And every row for the board must be soft-deleted (no live objects remain).
  await expect.poll(async () => {
    const { data } = await observer.from('objects').select('id').eq('board_id', boardId).eq('deleted', false)
    return data?.length ?? -1
  }, { timeout: 15_000, message: 'clear should soft-delete every board row' }).toBe(0)

  await observer.removeChannel(channel)
})
