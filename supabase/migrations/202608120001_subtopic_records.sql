alter table public.experiment_records
  add column if not exists subtopic_id text;

create index if not exists experiment_records_subtopic_idx
  on public.experiment_records(research_id, subtopic_id, created_at);

comment on column public.experiment_records.subtopic_id is
  'Client-generated ID of the subtopic this discussion or upload belongs to; null means topic-level.';
