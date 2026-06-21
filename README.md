# WorkOS

WorkOS is a Personal Work Operating System for recording tasks, projects, meetings, reflections, work logs, reports, time tracking, and work analytics.

It is not designed as a simple Todo List. Its purpose is to become a long-term work memory system.

## Current Status

Current version:

- Local-first MVP
- Data stored through the local repository / browser storage
- No Supabase connection yet
- No login system yet
- Work Analytics local version available

Do not start Supabase development until the project baseline and Constitution are confirmed.

## Tech Stack

- Next.js
- TypeScript
- Tailwind CSS
- shadcn-style UI primitives
- Local Repository / localStorage
- Future: Supabase Auth, Supabase Postgres, Supabase RLS, Vercel

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

## Supabase Plan

Supabase development has not started yet.

Future modules:

- Supabase Auth
- Supabase Postgres
- Supabase RLS
- Repository-based cloud sync
- Local-to-cloud migration
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

Future deployment checklist:

1. Push stable code to `main`
2. Configure environment variables in Vercel
3. Connect GitHub repository
4. Deploy from `main`
5. Verify local mode and cloud mode

Required Vercel variables:

```env
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEXT_PUBLIC_APP_URL
```

## Project Constitution

See:

```text
PROJECT_CONSTITUTION.md
```

All future development must follow that document.

