# Slate

A mobile-friendly **live blackboard**. Draw on a dark dotted-grid canvas and have it
sync in real time across every device signed into the same account — sketch on your
phone, watch it appear instantly on a big screen, laptop, or tablet. Each account holds
multiple boards, switched via tabs.

**Live site:** https://pattedyret.github.io/slate/

## How it works

- **Static front end** — Vite + React + TypeScript, served from GitHub Pages. The canvas
  is an *object model* (a list of strokes/shapes/text), rendered with Konva +
  perfect-freehand. Storing objects (not raw pixels) is what makes select/move/resize,
  undo/redo, and clean multi-device sync possible.
- **Supabase back end** — email/password auth, a Postgres store of board objects protected
  by Row-Level Security, and Realtime broadcast channels for live drawing. Every device
  talks to Supabase directly from the browser.
- **Two-tier sync** — while a finger is down, points stream over an ephemeral Realtime
  broadcast channel (never the database); on finger-up the finished object is broadcast
  once *and* written once to Postgres for durability. Opening a board reads its objects
  from the DB once, then listens for live updates. (Non-negotiable rule: no per-point DB writes.)
- **Security boundary** — the publishable (anon) key is safe to ship in a static site by
  design. Isolation comes from RLS: a user can only read/write `boards` and `objects`
  where `owner_id = auth.uid()`. This is enforced and tested (`tests/e2e/rls.spec.ts`).

## Features

Pen (color + size), eraser, line / rectangle / ellipse / arrow, text, select / move /
resize, undo / redo, clear board, dotted-grid toggle, fullscreen, multiple boards as
tabs (create / rename / delete), two-way live sync, instant email + password signup, and
PWA install ("Add to Home Screen").

## Develop

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev            # http://localhost:5173/slate/
```

`.env` is gitignored. For the deployed site, the same two values are stored as GitHub
Actions secrets (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). If they are missing, the
app renders a setup screen instead of crashing.

## Test

```bash
npm test                 # Vitest unit tests (history reducer, type round-trip)
npx playwright test      # e2e: RLS account isolation + live draw-sync (needs .env)
```

The e2e tests run against the live Supabase project, creating throwaway accounts.

## Database

The schema lives in `supabase/migrations/0001_init.sql` (`boards`, `objects`, and
owner-only RLS policies). With the Supabase CLI linked to the project:

```bash
supabase db push
```

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which type-checks, runs the
unit tests, builds, and publishes `dist/` to GitHub Pages. The Vite `base` is `/slate/`
to match the Pages path. You can also trigger a build manually:

```bash
gh workflow run "Deploy to GitHub Pages" --repo Pattedyret/slate
```

## Operational note (free tier)

Free Supabase projects **pause after ~7 days of inactivity**. The first load after a
break may need a quick un-pause in the [Supabase dashboard](https://supabase.com/dashboard).
This is expected on the free tier.
