// Shown on the deployed/dev site when Supabase env vars are missing, so the page
// loads cleanly and explains the one remaining configuration step instead of white-screening.
export function SetupNeeded() {
  return (
    <div className="login">
      <h1>Slate</h1>
      <div style={{ maxWidth: 420, textAlign: 'center', lineHeight: 1.5 }}>
        <p>Almost there — Slate just needs a Supabase backend.</p>
        <ol style={{ textAlign: 'left', color: '#8a93a7', fontSize: 14 }}>
          <li>Create a free project at supabase.com.</li>
          <li>Run <code>supabase/migrations/0001_init.sql</code> in its SQL editor.</li>
          <li>
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>
            {' '}(GitHub repo → Settings → Secrets → Actions for the live site, or a local <code>.env</code>),
            then redeploy.
          </li>
        </ol>
      </div>
    </div>
  )
}
