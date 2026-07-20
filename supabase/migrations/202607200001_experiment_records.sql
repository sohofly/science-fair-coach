create table public.experiment_records (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete cascade,
  topic_snapshot jsonb not null, method text not null check (char_length(method) between 1 and 10000),
  result text not null check (char_length(result) between 1 and 10000), file_name text, file_path text,
  mime_type text, ai_review text, created_at timestamptz not null default now()
);
create index experiment_records_student_time_idx on public.experiment_records(student_id, created_at);
alter table public.experiment_records enable row level security;
create policy "teachers view experiment records" on public.experiment_records for select to authenticated using (
  exists(select 1 from public.students s join public.classes c on c.id=s.class_id where s.id=student_id and c.teacher_id=auth.uid())
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(
  'experiment-records','experiment-records',false,8388608,array['image/jpeg','image/png','image/webp','application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
) on conflict(id) do nothing;
alter table public.thought_events drop constraint thought_events_event_type_check;
alter table public.thought_events add constraint thought_events_event_type_check check (event_type in (
  'joined','division_selected','profile_updated','interest_selected','observation_entered','question_shown','answer_submitted',
  'topics_recommended','topic_selected','topic_rejected','source_opened','teacher_comment','plan_created',
  'experiment_uploaded','experiment_reviewed','exported'
));
