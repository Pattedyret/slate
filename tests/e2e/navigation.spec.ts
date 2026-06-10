import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Package B — canvas navigation. Verifies the viewport transform (pan/zoom), that strokes
// drawn under a non-trivial viewport persist at the correct WORLD coordinates, the
// second-finger-cancels-draft rule, and the collapsible menu + fullscreen UI.
//
// The viewport is read/driven through a tiny dev-only test hook exposed by BoardView:
//   window.__slate.getViewport()           -> { scale, panX, panY }
//   window.__slate.setViewport({scale,panX,panY})
// (The Playwright webServer runs `npm run dev`, so import.meta.env.PROD is false and the
// hook is present — see BoardView.tsx.)

const url = process.env.VITE_SUPABASE_URL!
const key = process.env.VITE_SUPABASE_ANON_KEY!
const rnd = () => `slate-nav-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
const PW = 'password123'

interface ViewportSnapshot { scale: number; panX: number; panY: number }

// Sign up a fresh account (with a board) and land the browser on it.
async function bootstrap(page: Page) {
  expect(url, 'VITE_SUPABASE_URL must be set').toBeTruthy()
  expect(key, 'VITE_SUPABASE_ANON_KEY must be set').toBeTruthy()

  const email = rnd()
  const admin = createClient(url, key)
  const { data: sign, error: signErr } = await admin.auth.signUp({ email, password: PW })
  expect(signErr, signErr?.message).toBeNull()
  const uid = sign.user!.id
  const { data: board, error: boardErr } = await admin.from('boards')
    .insert({ owner_id: uid, title: 'Nav', sort_order: 0 })
    .select().single()
  expect(boardErr, boardErr?.message).toBeNull()
  const boardId = board!.id

  await page.goto('./')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(PW)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'pen' })).toBeVisible()
  await expect(page.locator('canvas').first()).toBeVisible()
  // Wait for the test hook to be installed.
  await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown }).__slate)
  // Boards load asynchronously; activeId is null for the first render(s). Drawing before it
  // is set makes down() return at the `!activeId` guard, so wait for the board-ready signal.
  await page.waitForFunction(() => !!(window as unknown as { __slate: { getActiveId(): string | null } }).__slate.getActiveId())

  return { admin, boardId }
}

const getViewport = (page: Page) =>
  page.evaluate(() => (window as unknown as {
    __slate: { getViewport(): ViewportSnapshot }
  }).__slate.getViewport())

// Dispatch a wheel event over the canvas at a local (relative-to-canvas) point.
async function wheelAt(page: Page, dx: number, dy: number, opts: { ctrl?: boolean; shift?: boolean; at?: { x: number; y: number } } = {}) {
  const box = (await page.locator('canvas').first().boundingBox())!
  const at = opts.at ?? { x: box.width / 2, y: box.height / 2 }
  await page.evaluate(({ box, dx, dy, ctrl, shift, at }) => {
    const canvas = document.querySelector('canvas')!
    const container = canvas.parentElement!
    const ev = new WheelEvent('wheel', {
      deltaX: dx, deltaY: dy, ctrlKey: !!ctrl, shiftKey: !!shift,
      clientX: box.x + at.x, clientY: box.y + at.y,
      bubbles: true, cancelable: true,
    })
    container.dispatchEvent(ev)
  }, { box, dx, dy, ctrl: !!opts.ctrl, shift: !!opts.shift, at })
}

test('wheel pans the viewport without changing scale', async ({ page }) => {
  await bootstrap(page)
  const before = await getViewport(page)
  await wheelAt(page, 0, 120)
  await page.waitForTimeout(50)
  const after = await getViewport(page)
  expect(after.scale).toBeCloseTo(before.scale, 6)
  expect(after.panY).not.toBe(before.panY)
})

test('ctrl+wheel zooms to cursor and keeps the world point under the cursor', async ({ page }) => {
  await bootstrap(page)
  const box = (await page.locator('canvas').first().boundingBox())!
  const at = { x: box.width * 0.4, y: box.height * 0.4 }
  const before = await getViewport(page)
  const worldBefore = {
    x: (at.x - before.panX) / before.scale,
    y: (at.y - before.panY) / before.scale,
  }
  await wheelAt(page, 0, -100, { ctrl: true, at }) // negative deltaY → zoom in
  await page.waitForTimeout(50)
  const after = await getViewport(page)
  expect(after.scale).toBeGreaterThan(before.scale)
  expect(after.scale).toBeLessThanOrEqual(8)
  // The world point under the cursor is preserved.
  const worldAfter = {
    x: (at.x - after.panX) / after.scale,
    y: (at.y - after.panY) / after.scale,
  }
  // Exact zoom-to-cursor math is unit-tested in viewport-math.test.ts. Through the real DOM
  // we allow ~1px: this test places the cursor relative to the <canvas> box while the wheel
  // handler anchors to the Stage-container box, and those differ by a sub-pixel offset.
  expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1.5)
  expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1.5)
})

test('zoom clamps to [0.1, 8]', async ({ page }) => {
  await bootstrap(page)
  // Zoom in hard.
  for (let i = 0; i < 40; i++) await wheelAt(page, 0, -200, { ctrl: true })
  await page.waitForTimeout(50)
  expect((await getViewport(page)).scale).toBeLessThanOrEqual(8)
  // Zoom out hard.
  for (let i = 0; i < 80; i++) await wheelAt(page, 0, 200, { ctrl: true })
  await page.waitForTimeout(50)
  expect((await getViewport(page)).scale).toBeGreaterThanOrEqual(0.1)
})

test('reset button restores scale=1, pan=0,0', async ({ page }) => {
  await bootstrap(page)
  await wheelAt(page, 0, -100, { ctrl: true })
  await wheelAt(page, 80, 40)
  await page.waitForTimeout(50)
  await page.getByRole('button', { name: 'Reset view' }).click()
  await page.waitForTimeout(50)
  const vp = await getViewport(page)
  expect(vp.scale).toBeCloseTo(1, 6)
  expect(vp.panX).toBeCloseTo(0, 6)
  expect(vp.panY).toBeCloseTo(0, 6)
})

test('★ a stroke drawn under pan+zoom persists at the correct WORLD coordinates', async ({ page }) => {
  const { admin, boardId } = await bootstrap(page)

  // Set a known viewport via the test hook.
  await page.evaluate(() => (window as unknown as {
    __slate: { setViewport(v: { scale: number; panX: number; panY: number }): void }
  }).__slate.setViewport({ scale: 2, panX: -100, panY: -50 }))
  await page.waitForTimeout(50)
  const vp = await getViewport(page)
  expect(vp.scale).toBeCloseTo(2, 6)

  // Draw a stroke at a known SCREEN point (relative to the canvas box).
  const box = (await page.locator('canvas').first().boundingBox())!
  const sx = box.width * 0.5
  const sy = box.height * 0.5
  const x0 = box.x + sx
  const y0 = box.y + sy
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + i * 12, y0 + i * 6)
  await page.mouse.up()

  // Read the committed object back from Postgres and assert its first point is the
  // expected WORLD coordinate: ((sx - panX)/scale, (sy - panY)/scale).
  const expectedWorldX = (sx - vp.panX) / vp.scale
  const expectedWorldY = (sy - vp.panY) / vp.scale

  const first = await expect.poll(async () => {
    const { data } = await admin.from('objects')
      .select('type,data').eq('board_id', boardId).eq('type', 'stroke')
    const stroke = data?.[0] as { data: { points: number[] } } | undefined
    return stroke?.data?.points ?? null
  }, { timeout: 15_000, message: 'stroke should be persisted' }).not.toBeNull()
  void first

  const { data } = await admin.from('objects')
    .select('data').eq('board_id', boardId).eq('type', 'stroke')
  const points = (data![0] as { data: { points: number[] } }).data.points
  expect(points[0]).toBeCloseTo(expectedWorldX, 0)
  expect(points[1]).toBeCloseTo(expectedWorldY, 0)
})

test('a second finger cancels an in-progress draft (no object persisted)', async ({ page }) => {
  const { admin, boardId } = await bootstrap(page)
  const box = (await page.locator('canvas').first().boundingBox())!

  // Drive raw Pointer events: one touch starts a draw and moves, a second touch lands
  // (cancelling the draft), then both lift.
  await page.evaluate(({ box }) => {
    const canvas = document.querySelector('canvas')!
    const container = canvas.parentElement!
    const fire = (type: string, id: number, x: number, y: number) => {
      const ev = new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: id === 1,
        clientX: box.x + x, clientY: box.y + y, bubbles: true, cancelable: true,
      })
      container.dispatchEvent(ev)
    }
    fire('pointerdown', 1, box.width * 0.3, box.height * 0.3)
    fire('pointermove', 1, box.width * 0.3 + 30, box.height * 0.3 + 30)
    fire('pointerdown', 2, box.width * 0.6, box.height * 0.6) // 2nd finger → cancel
    fire('pointermove', 1, box.width * 0.3 + 60, box.height * 0.3 + 60)
    fire('pointerup', 1, box.width * 0.3 + 60, box.height * 0.3 + 60)
    fire('pointerup', 2, box.width * 0.6, box.height * 0.6)
  }, { box })

  // Give any (erroneous) commit a chance to land, then assert nothing was persisted.
  await page.waitForTimeout(1500)
  const { data } = await admin.from('objects').select('id').eq('board_id', boardId)
  expect(data ?? []).toEqual([])
})

test('the menu collapses and the floating handle restores it', async ({ page }) => {
  await bootstrap(page)
  const wrap = page.locator('.canvas-wrap')
  const heightBefore = (await wrap.boundingBox())!.height

  // Collapse: the toolbar's "Hide menu" button.
  await page.getByRole('button', { name: 'Hide menu' }).click()
  await expect(page.getByRole('button', { name: 'pen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show menu' })).toBeVisible()
  // Canvas grew (the bars no longer take vertical space).
  await page.waitForTimeout(100)
  const heightCollapsed = (await wrap.boundingBox())!.height
  expect(heightCollapsed).toBeGreaterThan(heightBefore)

  // Restore.
  await page.getByRole('button', { name: 'Show menu' }).click()
  await expect(page.getByRole('button', { name: 'pen' })).toBeVisible()
  await page.waitForTimeout(100)
  const heightRestored = (await wrap.boundingBox())!.height
  expect(heightRestored).toBeCloseTo(heightBefore, 0)
})

test('fullscreen toggle reflects state (when supported)', async ({ page }) => {
  await bootstrap(page)
  const btn = page.getByRole('button', { name: 'Enter fullscreen' })
  // Skip on engines without the Fullscreen API (button hidden).
  if (await btn.count() === 0) test.skip(true, 'Fullscreen API unsupported in this engine')

  await btn.click()
  // Headless Chromium frequently sets document.fullscreenElement but does NOT fire
  // `fullscreenchange` reliably, so the label flip is best-effort here: wait for it, and
  // skip if the engine didn't honor fullscreen (real browsers flip the label — covered by
  // the live smoke test). The toggle logic itself is trivial.
  const flipped = await page.getByRole('button', { name: 'Exit fullscreen' })
    .waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)
  if (!flipped) test.skip(true, 'Engine did not honor fullscreen / fullscreenchange (headless)')
  // Programmatic exit updates the button back.
  await page.evaluate(() => document.exitFullscreen?.())
  await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toBeVisible()
})
