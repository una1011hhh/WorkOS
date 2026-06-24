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
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_OAUTH_REDIRECT_URI=http://localhost:3000/api/integrations/feishu/oauth/callback
```

Current local MVP does not require Supabase variables.

If Supabase values are empty, WorkOS stays in local mode.

Feishu variables are server-side only. Never create `NEXT_PUBLIC_FEISHU_APP_SECRET`.

For Vercel production, set:

```env
NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app
FEISHU_OAUTH_REDIRECT_URI=https://your-vercel-domain.vercel.app/api/integrations/feishu/oauth/callback
```

Add the same `FEISHU_OAUTH_REDIRECT_URI` value to the Feishu Open Platform app's OAuth redirect URL list.

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

## Supabase Minimum Cloud Loop

Current minimum loop:

1. Register with email and password in WorkOS settings
2. Log in from WorkOS settings
3. See sync status in the sidebar workspace card
4. Import existing local data into Supabase when prompted
5. Read cloud data after refresh
6. Log in on another device/browser with the same account and see the same WorkOS data
7. Log out and return to local mode

Notes:

- Local mode is still available when Supabase env vars are empty or when the user is logged out.
- Local data is not deleted after cloud import.
- Markdown / CSV / JSON export remains local browser download functionality.
- Current cloud mode persists Tasks, Projects, Meetings, Meeting Action Items, Reflections, Reports, and Time Sessions.

## Contacts, Groups, and Meeting Actions

This stage adds a lightweight contact system while keeping existing meeting data compatible.

What changed:

- Contacts can be created, edited, deleted, searched, and filtered by team / company.
- Contact groups can be created, edited, deleted, and assigned members.
- Meeting create / edit keeps manual attendee input.
- Meeting create / edit can also select contacts and groups.
- Selecting a group adds all group members and automatically deduplicates attendees.
- Meeting Action Items still save through the existing action item model.
- The visual Action Item editor stays synchronized with the text format:

```text
Action content | Owner | YYYY-MM-DD
```

Supabase migration:

```text
supabase/migrations/202606220001_contacts_and_groups.sql
```

After deploying this version, run the migration in Supabase SQL Editor. It creates only:

- `contacts`
- `contact_groups`

It does not rebuild existing tables and does not delete existing data.

Verification:

1. Log in to WorkOS.
2. Open Contacts.
3. Create a contact.
4. Create a group and add the contact.
5. Refresh the page and confirm both remain.
6. Open the same account on another device and confirm the contact / group appears.
7. Create or edit a meeting, select the contact / group, and save.
8. Confirm attendees are preserved after refresh.
9. Delete a task from Task Center and confirm it does not reappear after refresh.

### Cloud Sync Verification Checklist

After applying the migration and setting `.env.local`, run:

```bash
npm run dev
```

Then verify:

1. Open WorkOS and go to Settings.
2. Register or log in.
3. If local data exists, choose `导入云端`.
4. Confirm the sidebar status becomes `云端已同步`.
5. Refresh the page and confirm data is still visible.
6. Create or edit one task, project, meeting, reflection, or report.
7. Refresh again and confirm the change persists.

## Feishu Organization Sync V2

WorkOS can import Feishu organization contacts, visible group chats, group members, and calendar meetings into the existing Contacts / Contact Groups / Meetings system.

This integration is one-way:

- Feishu → WorkOS only
- No Feishu messages are synced
- No Feishu calendar or meeting creation is performed
- No data is written back to Feishu

### Feishu setup

1. Open Feishu Open Platform and create an internal enterprise app.
2. Copy the app credentials.
3. Enable the required permissions for your app.
4. Add these variables locally and in Vercel:

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_OAUTH_REDIRECT_URI=https://your-domain/api/integrations/feishu/oauth/callback
```

`FEISHU_APP_SECRET` is read only by Next.js API routes on the server. It must not be exposed to the browser and must not use a `NEXT_PUBLIC_` prefix.

Production meeting sync uses Feishu OAuth user authorization, not local `lark-cli` state. Before syncing meetings online:

1. Run `supabase/migrations/202606240001_feishu_user_oauth.sql`.
2. Configure `FEISHU_OAUTH_REDIRECT_URI` in Vercel and in the Feishu Open Platform app.
3. Open WorkOS settings and click `连接个人日历`.
4. After Feishu redirects back to WorkOS, use `同步会议`.

Recommended Feishu permissions:

- Read departments / department tree
- Read users by department
- Read user basic profile fields
- Read chats visible to the app / bot
- Read chat members
- Read calendars
- Read calendar events

The app availability range must include the people and groups you want to import. If only one user is returned, check whether the app is still limited to the current user, whether department traversal permissions are missing, or whether the app has not been published / enabled for the target range.

### Sync flow

1. Log in to WorkOS cloud mode.
2. Open Settings.
3. Find `集成设置 · 飞书组织同步`.
4. Click `测试飞书连接`.
5. Click one of:
   - `同步联系人`
   - `同步群组`
   - `同步群成员`
   - `同步会议`
   - `一键同步全部`
6. Open Contacts and confirm imported contacts and groups show the `飞书` source label.
7. Open Meeting Center and confirm imported meetings appear when calendar permissions are enabled.
8. Create or edit a meeting and select the imported contacts / groups from the existing selector.

### Imported fields

Contacts:

- `externalSource = feishu`
- `externalId = Feishu user_id / open_id`
- `feishuUserId`
- `openId`
- `unionId`
- `avatar`
- `departmentId`
- `departmentName`
- `jobTitle`
- `status`
- `rawPayload`

Contact groups:

- `externalSource = feishu`
- `externalId = Feishu chat_id`
- `ownerId`
- `memberCount`
- `rawPayload`

Contact group members:

- Stored in `contact_group_members`
- Existing `contact_groups.contact_ids` is also maintained for current UI compatibility

Meetings:

- `externalSource = feishu`
- `externalId = Feishu event_id`
- `calendarId`
- `organizerId`
- `location`
- `meetingUrl`
- `attendees`
- `rawPayload`

Supabase migration:

```text
supabase/migrations/202606230002_feishu_org_sync_v2.sql
```

Run this migration before using Feishu Organization Sync V2 in production.

Manual contacts and groups are not changed.
8. Open another browser profile or another computer.
9. Use the same Supabase environment variables and log in with the same account.
10. Confirm the same cloud data appears.

If sync fails, check:

- Supabase URL and publishable key
- Migration SQL has been executed
- Row Level Security policies exist
- Browser console / Supabase logs

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

## Time Session Correction Verification

When upgrading a Supabase project, run:

```sql
-- Paste and execute:
-- supabase/migrations/202606230001_time_session_corrections.sql
```

Manual acceptance checklist:

1. Start a task timer, pause or stop it, then open the task detail page.
2. Confirm each time session shows an `编辑时间` action.
3. Edit start time, end time, total duration, and note.
4. Try saving without a correction reason; WorkOS should block the save.
5. Try an end time earlier than the start time; WorkOS should block the save.
6. Save a valid correction and confirm the task actual hours update immediately.
7. Click `查看原始记录` and confirm original start/end/duration are still visible.
8. For long suspected sessions, confirm `疑似忘记关闭` is highlighted and `一键修正` opens the correction form.
9. Export Markdown / CSV and confirm time-session exports include original time, corrected time, edit reason, editor, and edited time.
10. In Supabase mode, refresh the page and confirm the corrected session remains synced.
