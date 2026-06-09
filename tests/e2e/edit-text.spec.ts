import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Package C: full text editing via an in-place HTML <textarea> overlay (replaces
// window.prompt). This test:
//   1. selects the text tool, clicks the canvas → the overlay opens,
//   2. picks the "Marker" font, types text, commits (blur),
//   3. polls Postgres for a `text` row with the expected content + fontFamily,
//   4. switches to select, double-clicks the text to re-edit, changes the words,
//      commits, and asserts the updated content persists.
//
// Harness mirrors draw-sync/sync-ops: an observer client creates the account + board so the
// boardId is known up front, the browser signs into the same account, then we poll Postgres.

const url = process.env.VITE_SUPABASE_URL!
const key = process.env.VITE_SUPABASE_ANON_KEY!
const rnd = () => `slate-text-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
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

test('text is created via the overlay (with font) and re-edited via double-click', async ({ page }) => {
  expect(url, 'VITE_SUPABASE_URL must be set').toBeTruthy()
  expect(key, 'VITE_SUPABASE_ANON_KEY must be set').toBeTruthy()

  const email = rnd()
  const observer = createClient(url, key)
  const { data: sign, error: signErr } = await observer.auth.signUp({ email, password: PW })
  expect(signErr, signErr?.message).toBeNull()
  expect(sign.session).toBeTruthy()
  const uid = sign.user!.id
  const { data: board, error: boardErr } = await observer.from('boards')
    .insert({ owner_id: uid, title: 'Text', sort_order: 0 })
    .select().single()
  expect(boardErr, boardErr?.message).toBeNull()
  const boardId = board!.id

  const canvas = await signInAndOpenBoard(page, email)
  const box = await canvas.boundingBox()
  expect(box).toBeTruthy()
  const px = box!.x + box!.width * 0.4
  const py = box!.y + box!.height * 0.4

  // 1. Text tool → font controls appear; pick the Marker font BEFORE placing so it seeds
  //    the new object's fontFamily.
  await page.getByRole('button', { name: 'text', exact: true }).click()
  await page.getByLabel('font family').selectOption('marker')

  // 2. Click the canvas to open the overlay, type, and commit by blurring (click elsewhere).
  await page.mouse.click(px, py)
  const overlay = page.locator('textarea.text-edit-overlay')
  await expect(overlay).toBeVisible()
  await overlay.fill('Hello Slate')
  // Commit via Ctrl+Enter (deterministic; blur also works).
  await overlay.press('Control+Enter')
  await expect(overlay).toBeHidden()

  // 3. The persisted text row must carry the content + fontFamily.
  await expect.poll(async () => {
    const { data } = await observer.from('objects')
      .select('id,type,data').eq('board_id', boardId).eq('type', 'text')
    const row = data?.find(r => (r.data as { text?: string }).text === 'Hello Slate')
    return row ? (row.data as { fontFamily?: string }).fontFamily : null
  }, { timeout: 15_000, message: 'created text should persist with fontFamily="marker"' }).toBe('marker')

  // 4. Re-edit: switch to select, double-click the text, replace the words, commit.
  await page.getByRole('button', { name: 'select', exact: true }).click()
  await page.mouse.dblclick(px, py)
  const overlay2 = page.locator('textarea.text-edit-overlay')
  await expect(overlay2).toBeVisible()
  await overlay2.fill('Edited Text')
  await overlay2.press('Control+Enter')
  await expect(overlay2).toBeHidden()

  // The updated content must persist (same row id; text changed).
  await expect.poll(async () => {
    const { data } = await observer.from('objects')
      .select('type,data').eq('board_id', boardId).eq('type', 'text')
    return data?.some(r => (r.data as { text?: string }).text === 'Edited Text') ?? false
  }, { timeout: 15_000, message: 're-edited text should persist the new content' }).toBe(true)
})
