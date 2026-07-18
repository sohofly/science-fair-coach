create extension if not exists pgcrypto;

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  join_code text not null unique check (join_code ~ '^[A-Z2-9]{6}$'),
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_code text not null,
  display_label text,
  pin_hash text not null,
  profile jsonb not null default '{}'::jsonb,
  selected_topic jsonb,
  created_at timestamptz not null default now(),
  active_until timestamptz generated always as (created_at + interval '365 days') stored,
  delete_after timestamptz generated always as (created_at + interval '395 days') stored,
  unique(class_id, student_code)
);

create table public.student_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.student_login_attempts (
  id bigint generated always as identity primary key,
  attempt_key text not null,
  attempted_at timestamptz not null default now()
);
create index student_login_attempts_key_time_idx on public.student_login_attempts(attempt_key, attempted_at);

create table public.thought_events (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  event_type text not null check (event_type in (
    'joined','division_selected','profile_updated','interest_selected',
    'observation_entered','question_shown','answer_submitted',
    'topics_recommended','topic_selected','topic_rejected',
    'source_opened','teacher_comment','plan_created','exported'
  )),
  content jsonb not null default '{}'::jsonb,
  source text not null default 'student' check (source in ('student','system','teacher')),
  created_at timestamptz not null default now()
);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  used_at timestamptz not null default now(),
  model text not null,
  request_id text
);
create index ai_usage_student_time_idx on public.ai_usage(student_id, used_at);

create index classes_teacher_idx on public.classes(teacher_id);
create index students_class_idx on public.students(class_id);
create index students_delete_idx on public.students(delete_after);
create index thought_events_student_time_idx on public.thought_events(student_id, created_at);
create index sessions_hash_idx on public.student_sessions(token_hash);

alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.student_sessions enable row level security;
alter table public.student_login_attempts enable row level security;
alter table public.thought_events enable row level security;
alter table public.ai_usage enable row level security;

create policy "teachers manage own classes" on public.classes
for all to authenticated using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

create policy "teachers view class students" on public.students
for select to authenticated using (
  exists(select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
);
revoke select on public.students from authenticated;
grant select(id,class_id,student_code,display_label,profile,selected_topic,created_at,active_until,delete_after) on public.students to authenticated;
create policy "teachers delete class students" on public.students
for delete to authenticated using (
  exists(select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
);
create policy "teachers label class students" on public.students
for update to authenticated using (
  exists(select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
) with check (
  exists(select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
);
revoke update on public.students from authenticated;
grant update(display_label) on public.students to authenticated;

create policy "teachers view thought histories" on public.thought_events
for select to authenticated using (
  exists(select 1 from public.students s join public.classes c on c.id=s.class_id
    where s.id=student_id and c.teacher_id=auth.uid())
);
create policy "teachers add comments" on public.thought_events
for insert to authenticated with check (
  source='teacher' and event_type='teacher_comment' and
  exists(select 1 from public.students s join public.classes c on c.id=s.class_id
    where s.id=student_id and c.teacher_id=auth.uid())
);

create or replace function public.make_join_code()
returns text language plpgsql volatile set search_path='' as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; result text := '';
begin
  for i in 1..6 loop result := result || substr(alphabet, 1+floor(random()*length(alphabet))::int, 1); end loop;
  return result;
end $$;

create or replace function public.create_class(class_name text)
returns public.classes language plpgsql security definer set search_path='public' as $$
declare result public.classes; code text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  loop
    code := public.make_join_code();
    begin
      insert into public.classes(teacher_id,name,join_code) values(auth.uid(),class_name,code) returning * into result;
      return result;
    exception when unique_violation then null;
    end;
  end loop;
end $$;
revoke all on function public.create_class(text) from public, anon;
grant execute on function public.create_class(text) to authenticated;
revoke execute on function public.make_join_code() from public, anon, authenticated;

create or replace function public.retention_status(created timestamptz)
returns text language sql stable as $$
  select case when now() >= created + interval '395 days' then 'expired'
              when now() >= created + interval '365 days' then 'read_only'
              else 'active' end
$$;

create or replace function public.purge_expired_students()
returns integer language plpgsql security definer set search_path='public' as $$
declare removed integer;
begin
  delete from public.student_sessions where expires_at <= now();
  delete from public.student_login_attempts where attempted_at <= now() - interval '1 day';
  delete from public.students where delete_after <= now();
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function public.purge_expired_students() from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;
select cron.schedule(
  'purge-expired-science-fair-students',
  '17 3 * * *',
  'select public.purge_expired_students()'
);
