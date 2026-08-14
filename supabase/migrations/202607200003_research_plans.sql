create table public.research_plans (
  student_id uuid primary key references public.students(id) on delete cascade,
  system_plan jsonb not null,
  current_plan jsonb not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.research_plan_suggestions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  comment text not null check (char_length(comment) between 1 and 2000),
  proposed_plan jsonb not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index research_plan_suggestions_student_idx on public.research_plan_suggestions(student_id, created_at);

alter table public.research_plans enable row level security;
alter table public.research_plan_suggestions enable row level security;
grant select on public.research_plans to authenticated;
grant select,insert on public.research_plan_suggestions to authenticated;

create policy "teachers view student research plans" on public.research_plans
for select to authenticated using (
  exists(select 1 from public.students s join public.classes c on c.id=s.class_id
    where s.id=student_id and c.teacher_id=auth.uid())
);

create policy "teachers view plan suggestions" on public.research_plan_suggestions
for select to authenticated using (
  exists(select 1 from public.students s join public.classes c on c.id=s.class_id
    where s.id=student_id and c.teacher_id=auth.uid())
);
create policy "teachers create plan suggestions" on public.research_plan_suggestions
for insert to authenticated with check (
  teacher_id=auth.uid() and exists(
    select 1 from public.students s join public.classes c on c.id=s.class_id
    where s.id=student_id and c.teacher_id=auth.uid()
  )
);

alter table public.thought_events drop constraint thought_events_event_type_check;
alter table public.thought_events add constraint thought_events_event_type_check check (event_type in (
  'joined','division_selected','profile_updated','interest_selected','observation_entered',
  'question_shown','answer_submitted','topics_recommended','topic_selected','topic_rejected',
  'source_opened','teacher_comment','plan_created','plan_suggested','plan_suggestion_accepted',
  'plan_suggestion_declined','exported'
));
create policy "teachers record plan suggestions" on public.thought_events
for insert to authenticated with check (
  source='teacher' and event_type='plan_suggested' and
  exists(select 1 from public.students s join public.classes c on c.id=s.class_id
    where s.id=student_id and c.teacher_id=auth.uid())
);
