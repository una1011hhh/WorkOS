alter table public.time_sessions
  add column if not exists note text,
  add column if not exists suspected_forgot_to_stop boolean not null default false,
  add column if not exists original_start_time timestamptz,
  add column if not exists original_end_time timestamptz,
  add column if not exists original_duration integer check (original_duration is null or original_duration >= 0),
  add column if not exists corrected_start_time timestamptz,
  add column if not exists corrected_end_time timestamptz,
  add column if not exists corrected_duration integer check (corrected_duration is null or corrected_duration >= 0),
  add column if not exists corrected_note text,
  add column if not exists edited_by text,
  add column if not exists edited_at timestamptz,
  add column if not exists edit_reason text;

alter table public.time_sessions
  drop constraint if exists time_session_corrected_end_after_start;

alter table public.time_sessions
  add constraint time_session_corrected_end_after_start
  check (corrected_end_time is null or corrected_start_time is null or corrected_end_time >= corrected_start_time);

-- Rollback:
-- alter table public.time_sessions
--   drop constraint if exists time_session_corrected_end_after_start,
--   drop column if exists edit_reason,
--   drop column if exists edited_at,
--   drop column if exists edited_by,
--   drop column if exists corrected_note,
--   drop column if exists corrected_duration,
--   drop column if exists corrected_end_time,
--   drop column if exists corrected_start_time,
--   drop column if exists original_duration,
--   drop column if exists original_end_time,
--   drop column if exists original_start_time,
--   drop column if exists suspected_forgot_to_stop,
--   drop column if exists note;
