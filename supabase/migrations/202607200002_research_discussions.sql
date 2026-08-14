alter table public.experiment_records
  add column if not exists record_kind text not null default 'experiment'
  check (record_kind in ('experiment','discussion'));
