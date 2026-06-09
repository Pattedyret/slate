import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Security gate: Row-Level Security must isolate accounts. User B must never be able to
// read user A's boards or objects. If this fails, the RLS policies are wrong — do not ship.
//
// This is a pure API test (no browser): it talks to the live Supabase project directly,
// exactly as the static site does from each device.

const url = process.env.VITE_SUPABASE_URL!
const key = process.env.VITE_SUPABASE_ANON_KEY!

const rnd = () => `slate-rls-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
const PW = 'password123'

test('RLS isolates accounts: user B cannot read user A boards or objects', async () => {
  expect(url, 'VITE_SUPABASE_URL must be set').toBeTruthy()
  expect(key, 'VITE_SUPABASE_ANON_KEY must be set').toBeTruthy()

  const A = createClient(url, key)
  const B = createClient(url, key)

  // Instant signup (email confirmation is disabled) yields a usable session immediately.
  const { data: aSign, error: aErr } = await A.auth.signUp({ email: rnd(), password: PW })
  expect(aErr, aErr?.message).toBeNull()
  expect(aSign.session, 'instant signup must return a session').toBeTruthy()
  const aUid = aSign.user!.id

  // A creates a private board + object.
  const { data: board, error: bErr } = await A.from('boards')
    .insert({ owner_id: aUid, title: 'secret', sort_order: 0 })
    .select().single()
  expect(bErr, bErr?.message).toBeNull()
  expect(board).toBeTruthy()

  const objId = crypto.randomUUID()
  const { error: oErr } = await A.from('objects').insert({
    id: objId, board_id: board!.id, owner_id: aUid, type: 'stroke',
    data: { points: [0, 0, 10, 10], color: '#eaeefb', size: 4 },
  })
  expect(oErr, oErr?.message).toBeNull()

  // A can read its own data back (Data API is reachable + owner SELECT policy works).
  const { data: aBoards } = await A.from('boards').select('*').eq('id', board!.id)
  const { data: aObjs } = await A.from('objects').select('*').eq('id', objId)
  expect(aBoards).toHaveLength(1)
  expect(aObjs).toHaveLength(1)

  // B is a different account. RLS must hide A's rows entirely.
  const { error: bSignErr } = await B.auth.signUp({ email: rnd(), password: PW })
  expect(bSignErr, bSignErr?.message).toBeNull()

  const { data: bBoards } = await B.from('boards').select('*').eq('id', board!.id)
  const { data: bObjs } = await B.from('objects').select('*').eq('board_id', board!.id)
  expect(bBoards, 'B must not see A boards').toEqual([])
  expect(bObjs, 'B must not see A objects').toEqual([])

  // B must also be unable to mutate A's rows (update returns 0 affected rows under RLS).
  const { data: hijack } = await B.from('boards').update({ title: 'hijacked' }).eq('id', board!.id).select()
  expect(hijack, 'B must not be able to update A boards').toEqual([])
})
