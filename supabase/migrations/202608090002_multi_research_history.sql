alter table public.students add column if not exists login_email text;
create unique index if not exists students_class_login_email_idx
  on public.students(class_id, lower(login_email)) where login_email is not null;

create table if not exists public.research_projects (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  title text not null default '新研究歷程' check (char_length(title) between 1 and 200),
  status text not null default 'active' check (status in ('active','completed')),
  profile jsonb not null default '{}'::jsonb,
  selected_topic jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists research_projects_student_time_idx on public.research_projects(student_id, created_at desc);

insert into public.research_projects(student_id,title,profile,selected_topic,created_at)
select s.id, coalesce(nullif(s.selected_topic->>'title',''),'原有研究歷程'), s.profile, s.selected_topic, s.created_at
from public.students s
where not exists(select 1 from public.research_projects p where p.student_id=s.id);

alter table public.thought_events add column if not exists research_id uuid references public.research_projects(id) on delete cascade;
alter table public.experiment_records add column if not exists research_id uuid references public.research_projects(id) on delete cascade;
alter table public.research_plans add column if not exists research_id uuid references public.research_projects(id) on delete cascade;
alter table public.research_plan_suggestions add column if not exists research_id uuid references public.research_projects(id) on delete cascade;

update public.thought_events x set research_id=(select p.id from public.research_projects p where p.student_id=x.student_id order by p.created_at limit 1) where research_id is null;
update public.experiment_records x set research_id=(select p.id from public.research_projects p where p.student_id=x.student_id order by p.created_at limit 1) where research_id is null;
update public.research_plans x set research_id=(select p.id from public.research_projects p where p.student_id=x.student_id order by p.created_at limit 1) where research_id is null;
update public.research_plan_suggestions x set research_id=(select p.id from public.research_projects p where p.student_id=x.student_id order by p.created_at limit 1) where research_id is null;

alter table public.thought_events alter column research_id set not null;
alter table public.experiment_records alter column research_id set not null;
alter table public.research_plans alter column research_id set not null;
alter table public.research_plan_suggestions alter column research_id set not null;
alter table public.research_plans drop constraint if exists research_plans_pkey;
alter table public.research_plans add primary key(research_id);

alter table public.research_projects enable row level security;
grant select on public.research_projects to authenticated;
create policy "teachers view student research projects" on public.research_projects
for select to authenticated using (
  exists(select 1 from public.students s join public.classes c on c.id=s.class_id
    where s.id=student_id and c.teacher_id=auth.uid())
);

revoke select on public.students from authenticated;
grant select(id,class_id,student_code,login_email,display_label,profile,selected_topic,created_at,active_until,delete_after) on public.students to authenticated;

drop policy if exists "teachers add comments" on public.thought_events;
create policy "teachers add comments" on public.thought_events
for insert to authenticated with check (
  source='teacher' and event_type='teacher_comment' and
  exists(select 1 from public.research_projects p join public.students s on s.id=p.student_id join public.classes c on c.id=s.class_id
    where p.id=research_id and s.id=student_id and c.teacher_id=auth.uid())
);

drop policy if exists "teachers record plan suggestions" on public.thought_events;
create policy "teachers record plan suggestions" on public.thought_events
for insert to authenticated with check (
  source='teacher' and event_type='plan_suggested' and
  exists(select 1 from public.research_projects p join public.students s on s.id=p.student_id join public.classes c on c.id=s.class_id
    where p.id=research_id and s.id=student_id and c.teacher_id=auth.uid())
);
