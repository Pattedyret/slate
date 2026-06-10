import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Package D — S Pen radial quick menu (long-press). Verifies:
//   (a) a stationary long-press opens the wheel; picking a tool sector swaps the active tool.
//   (b) GHOST-STROKE regression: a long-press that opens the menu (then dismisses) commits
//       NO object locally AND broadcasts nothing to a second observer on the same board.
//       (Package B defers the first live broadcast until movement > tolerance; this asserts
//       that end-to-end — a held-still long-press never leaks a stroke to mirror devices.)
//
// Long-press is timing + movement based, so we dispatch raw Pointer events on the Stage
// container and hold (no move, no up) past LONGPRESS_MS (500ms) before asserting.
// Object state / active tool are read via BoardView's dev-only `window.__slate` hook.

const url = process.env.VITE_SUPABASE_URL!
const key = process.env.VITE_SUPABASE_ANON_KEY!
const rnd = () => `slate-radial-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
const PW = 'password123'
const LONGPRESS_MS = 500

interface SlateHook {
  getObjectCount(): number
  getTool(): string
  getViewport(): { scale: number; panX: number; panY: number }
  getActiveId(): string | null
}

async function bootstrap(page: Page): Promise<{ admin: SupabaseClient; boardId: string; email: string }> {
  expect(url, 'VITE_SUPABASE_URL must be set').toBeTruthy()
  expect(key, 'VITE_SUPABASE_ANON_KEY must be set').toBeTruthy()

  const email = rnd()
  const admin = createClient(url, key)
  const { data: sign, error: signErr } = await admin.auth.signUp({ email, password: PW })
  expect(signErr, signErr?.message).toBeNull()
  const uid = sign.user!.id
  const { data: board, error: boardErr } = await admin.from('boards')
    .insert({ owner_id: uid, title: 'Radial', sort_order: 0 })
    .select().single()
  expect(boardErr, boardErr?.message).toBeNull()
  const boardId = board!.id as string

  await page.goto('./')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(PW)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'pen' })).toBeVisible()
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown }).__slate)
  // Boards load asynchronously; wait for activeId before any gesture (down() returns early
  // at the `!activeId` guard otherwise — both drawing AND long-press arming are gated on it).
  await page.waitForFunction(() => !!(window as unknown as { __slate: SlateHook }).__slate.getActiveId())

  return { admin, boardId, email }
}

const hook = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __slate: SlateHook }).__slate
    return { count: h.getObjectCount(), tool: h.getTool() }
  })

// Dispatch a Pointer event on the Stage container (canvas.parentElement) at a point
// relative to the canvas box.
async function firePointer(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  at: { x: number; y: number },
  opts: { id?: number; pointerType?: string } = {},
) {
  const box = (await page.locator('canvas').first().boundingBox())!
  await page.evaluate(({ box, type, at, id, pointerType }) => {
    const canvas = document.querySelector('canvas')!
    const container = canvas.parentElement!
    const ev = new PointerEvent(type, {
      pointerId: id ?? 1,
      pointerType: pointerType ?? 'pen',
      isPrimary: true,
      clientX: box.x + at.x,
      clientY: box.y + at.y,
      bubbles: true,
      cancelable: true,
    })
    container.dispatchEvent(ev)
  }, { box, type, at, id: opts.id ?? 1, pointerType: opts.pointerType ?? 'pen' })
}

// RadialMenu geometry (must mirror src/board/RadialMenu.tsx). The SVG is a square of side
// 2*VIEW with the wheel centered at its middle; tools are 8 equal sectors starting at the
// top (12 o'clock = index 0 = 'pen').
const R_TOOL_INNER = 34
const R_TOOL_OUTER = 92
const R_COLOR_OUTER = 134
const PAD = 16
const VIEW = R_COLOR_OUTER + PAD
const WHEEL_TOOLS = ['pen', 'eraser', 'line', 'rect', 'ellipse', 'arrow', 'text', 'select']

// Click the painted midpoint of a tool sector. Clicking the <g>'s bbox center would miss
// the curved arc (the bbox center can fall in the donut hole), so we compute the radial
// midpoint from the rendered menu box and click that screen pixel directly.
async function clickToolSector(page: Page, tool: string) {
  const menuBox = (await page.locator('.radial-menu').boundingBox())!
  const cx = menuBox.x + VIEW // wheel center (the menu box is exactly 2*VIEW square)
  const cy = menuBox.y + VIEW
  const i = WHEEL_TOOLS.indexOf(tool)
  const step = (2 * Math.PI) / WHEEL_TOOLS.length
  const startAngle = -Math.PI / 2 - step / 2
  const mid = startAngle + (i + 0.5) * step
  const r = (R_TOOL_INNER + R_TOOL_OUTER) / 2
  await page.mouse.click(cx + r * Math.cos(mid), cy + r * Math.sin(mid))
}

test('a stationary long-press opens the radial menu; picking a tool sector swaps the active tool', async ({ page }) => {
  await bootstrap(page)
  const box = (await page.locator('canvas').first().boundingBox())!
  const center = { x: box.width * 0.5, y: box.height * 0.5 }

  // Default tool is pen.
  expect((await hook(page)).tool).toBe('pen')

  // Press and HOLD (no move, no up) past the long-press delay.
  await firePointer(page, 'pointerdown', center, { pointerType: 'pen' })
  await page.waitForTimeout(LONGPRESS_MS + 150)

  // The wheel appears, centered near the press point.
  const menu = page.locator('.radial-menu')
  await expect(menu).toBeVisible()

  // No object was committed by the hold (draft cancelled on open).
  expect((await hook(page)).count).toBe(0)

  // Pick the eraser sector → tool swaps AND the wheel dismisses. (Click the computed
  // painted midpoint of the curved sector — see clickToolSector.)
  await clickToolSector(page, 'eraser')
  await expect(menu).toHaveCount(0)
  await expect.poll(async () => (await hook(page)).tool).toBe('eraser')

  // The Toolbar reflects it too (wheel + Toolbar share useTool).
  await expect(page.getByRole('button', { name: 'eraser' })).toHaveClass(/active/)
})

test('★ a long-press that opens then dismisses the menu commits no object and broadcasts nothing to a second observer', async ({ page }) => {
  const { admin, boardId, email } = await bootstrap(page)

  // A second context (the "mirror device") on the SAME board: subscribe to the board
  // channel BEFORE the long-press so there's no subscribe/draw race. It must NEVER receive
  // a live/commit broadcast — proving B's deferral means a held-still long-press leaks nothing.
  const observer = createClient(url, key)
  const { error: obsErr } = await observer.auth.signInWithPassword({ email, password: PW })
  expect(obsErr, obsErr?.message).toBeNull()
  let leaked: { event: string } | null = null
  const channel = observer.channel(`board:${boardId}`, { config: { broadcast: { self: false } } })
  channel
    .on('broadcast', { event: 'live' }, () => { leaked = { event: 'live' } })
    .on('broadcast', { event: 'commit' }, () => { leaked = { event: 'commit' } })
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`channel: ${status}`))
    })
  })
  // Let the page's own channel finish subscribing before the gesture.
  await page.waitForTimeout(2000)

  const box = (await page.locator('canvas').first().boundingBox())!
  const center = { x: box.width * 0.5, y: box.height * 0.5 }

  const before = (await hook(page)).count

  // "Stationary" long-press with realistic stylus JITTER. This is the crux of the
  // regression: the pointer wobbles a few sub-tolerance px while held (each move < 8px from
  // the press point, so the long-press still arms), and the moves are spaced > the 33ms
  // live-broadcast throttle. WITHOUT B's deferral those jitter points broadcast as `live`
  // and stick forever on the mirror device (liveDrafts only clears on commit/delete); WITH
  // it, `moved` stays false so nothing is sent. A no-move hold would NOT exercise this.
  await firePointer(page, 'pointerdown', center, { pointerType: 'pen' })
  const jitter = [{ x: 2, y: 1 }, { x: -2, y: 2 }, { x: 1, y: -2 }, { x: -1, y: 1 }]
  for (const j of jitter) {
    await firePointer(page, 'pointermove', { x: center.x + j.x, y: center.y + j.y }, { pointerType: 'pen' })
    await page.waitForTimeout(40) // clear the 33ms throttle so any leak would actually emit
  }
  await page.waitForTimeout(LONGPRESS_MS) // ensure total hold exceeds the long-press delay
  await expect(page.locator('.radial-menu')).toBeVisible()

  // Release the (consumed) pointer, then dismiss the wheel by tapping outside it.
  await firePointer(page, 'pointerup', center, { pointerType: 'pen' })
  await page.locator('.radial-overlay').click({ position: { x: 4, y: 4 } })
  await expect(page.locator('.radial-menu')).toHaveCount(0)

  // Give any erroneous broadcast / commit time to land.
  await page.waitForTimeout(1500)

  // (1) No local object was created by the hold.
  expect((await hook(page)).count).toBe(before)
  // (2) Nothing was persisted to Postgres for this board.
  const { data } = await admin.from('objects').select('id').eq('board_id', boardId)
  expect(data ?? []).toEqual([])
  // (3) The mirror observer never received a live or commit broadcast — no ghost stroke.
  expect(leaked).toBeNull()

  await observer.removeChannel(channel)
})
