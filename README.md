# WorkOS

WorkOS is a Personal Work Operating System for recording tasks, projects, meetings, reflections, work logs, reports, time tracking, and work analytics.

It is not designed as a simple Todo List. Its purpose is to become a long-term work memory system.

## Current Status

Current version:

- Local-first MVP
- Data stored through the local repository / browser storage
- Supabase cloud-sync foundation added on `feature/supabase-cloud-sync`
- Auth provider and settings-based login UI added
- Sync status is visible in the workspace profile area
- First-login local-to-cloud import prompt is available
- Work Analytics local version available

Current cloud stage is foundation-only. It does not remove localStorage mode and does not redesign the UI.

## Tech Stack

- Next.js
- TypeScript
- Tailwind CSS
- shadcn-style UI primitives
- Local Repository / localStorage
- Supabase Auth
- Supabase Postgres
- Supabase RLS
- Vercel

## Local Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Type check:

```bash
npx tsc --noEmit
```

If lint is configured later, every development cycle must also run:

```bash
npm run lint
```

## Git Workflow

Branches:

- `main`: stable production baseline
- `develop`: development and testing baseline
- `feature/*`: new features
- `fix/*`: bug fixes

Do not develop directly on `main`.

Recommended flow:

```bash
git checkout main
git pull
git checkout -b feature/feature-name
```

Before merge:

```bash
npx tsc --noEmit
npm run build
```

## Data Safety

Before every change:

```text
建议先导出数据备份
```

Rules:

- Do not delete user data
- Do not overwrite user data
- Do not reset databases to apply schema changes
- Do not use fake or random data for real analytics
- Keep local export and backup capability

## Environment Variables

Create `.env.local` from:

```bash
cp .env.local.example .env.local
```

Variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Current local MVP does not require Supabase variables.

If Supabase values are empty, WorkOS stays in local mode.

## Supabase Cloud Foundation

This stage adds:

- Supabase browser client configuration
- Auth provider and login/logout method foundation
- Settings dialog login / signup / logout UI
- Sidebar sync status display
- Local data import-to-cloud prompt
- Repository abstraction
- Supabase repository implementation scaffold
- Initial Postgres schema migration
- Vercel deployment variable documentation

Files:

```text
lib/supabase/client.ts
lib/supabase/database.types.ts
lib/auth/auth-context.tsx
repositories/
supabase/migrations/202606210001_initial_workos_schema.sql
```

Cloud modules planned after this foundation:

- Cloud sync conflict handling
- JSON restore into cloud mode
- Sync audit log
- Multi-device sync

Planned tables:

- `profiles`
- `projects`
- `tasks`
- `time_sessions`
- `meetings`
- `meeting_action_items`
- `reflections`
- `reports`

All user-owned tables must include:

- `id`
- `user_id`
- `created_at`
- `updated_at`

All user-owned tables must enable Row Level Security.

### Running the Migration

Create a Supabase project, then run:

```sql
-- Paste and execute:
-- supabase/migrations/202606210001_initial_workos_schema.sql
```

The migration creates:

- Tables for profiles, projects, tasks, time sessions, meetings, action items, reflections, and reports
- Row Level Security policies
- `updated_at` triggers
- A `task_time_totals` view
- A partial unique index that allows only one running timer per user

Rollback guidance is included at the bottom of the migration file.

## Repository Architecture

Components must not call Supabase directly.

Data access must go through repositories:

```text
repositories/
  localWorkDataRepository
  supabaseWorkDataRepository
  workDataRepository
```

Source strategy:

```text
Not logged in: localStorage
Logged in: Supabase
```

Current UI still uses the proven local repository. The new repository layer is ready for the next phase, where login and sync behavior will be connected without rewriting existing pages.

Future data sources should be replaceable without rewriting UI components.

## Data Migration

Future first-login behavior:

1. Detect local WorkOS data
2. Ask whether to import local data to cloud
3. Import Tasks, Projects, Meetings, Reflections, Reports, and Time Sessions
4. Preserve local data
5. Avoid duplicate imports

Never delete local data after cloud import.

## Backup and Restore

Supported export formats:

- Markdown
- CSV
- JSON backup

JSON is for backup / restore only and should not be the default human-readable export.

Future restore support:

- Import JSON backup
- Validate schema
- Preserve relationships
- Avoid duplicate records

## Vercel Deployment

Deployment checklist:

1. Push stable code to `main`
2. Configure environment variables in Vercel
3. Connect GitHub repository
4. Deploy from `main`
5. Verify local mode
6. After login UI is connected, verify cloud mode and multi-device sync

Required Vercel variables:

```env
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEXT_PUBLIC_APP_URL
```

Do not expose `SUPABASE_SECRET_KEY` to client components. Client code must only use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## Project Constitution

See:

```text
PROJECT_CONSTITUTION.md
```

All future development must follow that document.
