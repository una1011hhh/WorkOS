# Vercel Timeout Remediation

This project should deploy as a static-first Next.js app. It has no API routes,
no middleware, and no server actions in this repository.

Production safeguards added:

- Home page is forced static.
- Supabase browser requests use AbortController timeouts.
- Supabase reads have per-table row caps and query timeouts.
- Supabase writes are chunked and timeout-bounded.
- App startup loads local data first and never blocks first paint on Supabase.
- Cloud import and cloud refresh are explicit user actions.
- Auto background cloud save is disabled; normal edits persist locally.
- No Vercel cron jobs are declared.

Vercel dashboard actions:

1. Disable Fluid Compute for this project unless another branch adds server
   functions that truly need it.
2. Remove any project-level cron or external monitor hitting the deployment.
3. Check deployment logs for old branches or previous builds that still include
   Feishu sync/API routes.
4. Redeploy from the commit containing these changes and clear old deployments
   if they are still receiving traffic.
