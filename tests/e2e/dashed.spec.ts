import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Package C: dashed/dotted styling for line/arrow/rect/ellipse.
//
// The line-style picker is dual-bound: with a dashable tool active it sets the *next*
// object's `dash`. This test selects the rect tool, picks "dashed", drags a rectangle,
// and asserts the persisted JSONB carries `data.dash === 'dashed'`.
//
// Harness mirrors draw-sync/sync-ops: an observer client creates the account + board so the
// boardId is known up front, the browser signs into the same account, acts, then we poll
// Postgres for the persisted row.

const url = process.env.VITE_SUPABASE_URL!
const key = process.env.VITE_SUPABASE_ANON_KEY!
const rnd = () => `slate-dash-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
const PW = 'password123'

async function signInAndOpenBoard(page: Page, email: string) {
  await page.goto('./')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(PW)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'pen' })).toBeVisible()
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  await page.waitForTimeout(2000) // let the app channel finish subscribing
  return canvas
}

test('a dashed rectangle persists data.dash === "dashed"', async ({ page }) => {
  expect(url, 'VITE_SUPABASE_URL must be set').toBeTruthy()
  expect(key, 'VITE_SUPABASE_ANON_KEY must be set').toBeTruthy()

  const email = rnd()
  const observer = createClient(url, key)
  const { data: sign, error: signErr } = await observer.auth.signUp({ email, password: PW })
  expect(signErr, signErr?.message).toBeNull()
  expect(sign.session).toBeTruthy()
  const uid = sign.user!.id
  const { data: board, error: boardErr } = await observer.from('boards')
    .insert({ owner_id: uid, title: 'Dash', sort_order: 0 })
    .select().single()
  expect(boardErr, boardErr?.message).toBeNull()
  const boardId = board!.id

  const canvas = await signInAndOpenBoard(page, email)

  // Select the rect tool. The line-style picker becomes visible for dashable tools.
  await page.getByRole('button', { name: 'rect', exact: true }).click()
  // Pick the "dashed" line style.
  await page.getByRole('button', { name: 'line style dashed' }).click()

  // Drag a rectangle on the canvas.
  const box = await canvas.boundingBox()
  expect(box).toBeTruthy()
  const x0 = box!.x + box!.width * 0.3
  const y0 = box!.y + box!.height * 0.35
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(x0 + i * 18, y0 + i * 12)
    await page.waitForTimeout(30)
  }
  await page.mouse.up()

  // The persisted rect must carry data.dash === 'dashed'.
  await expect.poll(async () => {
    const { data } = await observer.from('objects')
      .select('type,data').eq('board_id', boardId).eq('type', 'rect')
    const row = data?.find(r => (r.data as { dash?: string }).dash === 'dashed')
    return row ? (row.data as { dash?: string }).dash : null
  }, { timeout: 15_000, message: 'dashed rect should be persisted with data.dash="dashed"' }).toBe('dashed')
})
