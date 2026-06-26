alter table public.meetings
  add column if not exists start_time timestamptz;

update public.meetings
set start_time = date
where start_time is null
  and date is not null
  and to_char(date at time zone 'Asia/Shanghai', 'HH24:MI') <> '00:00';

create index if not exists meetings_user_start_time_idx
  on public.meetings(user_id, start_time);
