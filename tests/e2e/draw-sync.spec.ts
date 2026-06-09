import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Headline feature: drawing on one device appears live on another, in real time,
// over a Supabase Realtime broadcast channel (the "in-flight + commit" tier).
//
// Strategy (deterministic, no Konva-internals polling):
//   1. A test client signs up an account and creates a board, so the board id is known up front.
//   2. An independent Realtime "observer" subscribes to that board's channel BEFORE any drawing,
//      removing the subscribe/draw race.
//   3. A real browser signs into the SAME account, lands on that board, and draws a pen stroke.
//   4. The observer must receive a broadcast (live points and/or the final commit), and the
//      finished stroke must be persisted to Postgres.
// This exercises the exact publishable-key + Realtime + RLS path the deployed site uses.

const url = process.env.VITE_SUPABASE_URL!
const key = process.env.VITE_SUPABASE_ANON_KEY!
const rnd = () => `slate-sync-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
const PW = 'password123'

test('a stroke drawn in the browser is broadcast live and persisted', async ({ page }) => {
  expect(url, 'VITE_SUPABASE_URL must be set').toBeTruthy()
  expect(key, 'VITE_SUPABASE_ANON_KEY must be set').toBeTruthy()

  const email = rnd()
  const observer = createClient(url, key)

  // 1. Create the account + a board so its id is known before drawing.
  const { data: sign, error: signErr } = await observer.auth.signUp({ email, password: PW })
  expect(signErr, signErr?.message).toBeNull()
  expect(sign.session).toBeTruthy()
  const uid = sign.user!.id
  const { data: board, error: boardErr } = await observer.from('boards')
    .insert({ owner_id: uid, title: 'Sync', sort_order: 0 })
    .select().single()
  expect(boardErr, boardErr?.message).toBeNull()
  const boardId = board!.id

  // 2. Observer subscribes to the board channel and resolves on the first live/commit broadcast.
  let firstEvent: { event: string; payload: unknown } | null = null
  const channel = observer.channel(`board:${boardId}`, { config: { broadcast: { self: false } } })
  const gotBroadcast = new Promise<{ event: string; payload: unknown }>((resolve) => {
    const capture = (event: string) => ({ payload }: { payload: unknown }) => {
      if (!firstEvent) { firstEvent = { event, payload }; resolve(firstEvent) }
    }
    channel
      .on('broadcast', { event: 'live' }, capture('live'))
      .on('broadcast', { event: 'commit' }, capture('commit'))
  })
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`channel: ${status}`))
    })
  })

  // 3. Browser signs into the same account and lands on the board.
  await page.goto('./')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(PW)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Wait for the board UI (toolbar + canvas) — confirms sign-in + board load succeeded.
  await expect(page.getByRole('button', { name: 'pen' })).toBeVisible()
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  // Give the app's own channel a moment to finish subscribing before we draw.
  await page.waitForTimeout(2000)

  // 4. Draw a pen stroke (pen is the default tool).
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

  // The observer must have received a live/commit broadcast from the browser.
  const event = await Promise.race([
    gotBroadcast,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no broadcast received within 20s')), 20_000)),
  ])
  expect(['live', 'commit']).toContain(event.event)

  // The finished stroke must be persisted to Postgres (read back by the same account).
  await expect.poll(async () => {
    const { data } = await observer.from('objects').select('id,type').eq('board_id', boardId)
    return data?.length ?? 0
  }, { timeout: 15_000, message: 'committed stroke should be persisted' }).toBeGreaterThan(0)

  await observer.removeChannel(channel)
})
