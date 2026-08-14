alter table public.thought_events drop constraint if exists thought_events_event_type_check;
alter table public.thought_events add constraint thought_events_event_type_check check (event_type in (
  'joined','division_selected','profile_updated','interest_selected','observation_entered',
  'question_shown','answer_submitted','topics_recommended','topic_selected','topic_rejected',
  'source_opened','teacher_comment','plan_created','plan_suggested','plan_suggestion_accepted',
  'plan_suggestion_declined','experiment_uploaded','experiment_reviewed','reflection_added','exported'
));
