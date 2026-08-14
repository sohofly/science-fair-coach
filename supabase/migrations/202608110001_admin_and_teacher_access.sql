create table if not exists public.teacher_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.teacher_profiles(user_id,email,display_name)
select id,lower(email),coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name')
from auth.users where email is not null
on conflict(user_id) do update set email=excluded.email;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(key,value) values('teacher_google_login','false'::jsonb)
on conflict(key) do nothing;

create table if not exists public.administrators (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  must_change_password boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.administrators(username,password_hash,must_change_password)
values('admin',extensions.crypt('admin',extensions.gen_salt('bf',12)),true)
on conflict(username) do nothing;

create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  administrator_id uuid not null references public.administrators(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null default(now()+interval '8 hours'),
  created_at timestamptz not null default now()
);
create index if not exists admin_sessions_expiry_idx on public.admin_sessions(expires_at);

alter table public.teacher_profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.administrators enable row level security;
alter table public.admin_sessions enable row level security;
revoke all on public.teacher_profiles,public.app_settings,public.administrators,public.admin_sessions from anon,authenticated;

create or replace function public.is_active_teacher(target uuid default auth.uid())
returns boolean language sql stable security definer set search_path='public' as $$
  select exists(select 1 from public.teacher_profiles where user_id=target and active)
$$;
revoke all on function public.is_active_teacher(uuid) from public,anon;
grant execute on function public.is_active_teacher(uuid) to authenticated;

create or replace function public.ensure_teacher_access()
returns jsonb language plpgsql security definer set search_path='public','auth' as $$
declare uid uuid:=auth.uid(); mail text; google_enabled boolean; profile public.teacher_profiles;
begin
  if uid is null then raise exception 'authentication required'; end if;
  select * into profile from public.teacher_profiles where user_id=uid;
  if found then
    if not profile.active then raise exception 'teacher account disabled'; end if;
    return jsonb_build_object('allowed',true,'email',profile.email,'displayName',profile.display_name);
  end if;
  select coalesce((value #>> '{}')::boolean,false) into google_enabled from public.app_settings where key='teacher_google_login';
  if not google_enabled then raise exception 'teacher account not registered'; end if;
  select lower(email) into mail from auth.users where id=uid;
  if mail is null then raise exception 'teacher email required'; end if;
  insert into public.teacher_profiles(user_id,email,display_name) select id,lower(email),coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name') from auth.users where id=uid returning * into profile;
  return jsonb_build_object('allowed',true,'email',profile.email,'displayName',profile.display_name);
end $$;
revoke all on function public.ensure_teacher_access() from public,anon;
grant execute on function public.ensure_teacher_access() to authenticated;

create or replace function public.verify_admin_password(login_name text,login_password text)
returns table(admin_id uuid,must_change boolean) language sql security definer set search_path='public' as $$
  select id,must_change_password from public.administrators
  where username=login_name and password_hash=extensions.crypt(login_password,password_hash)
$$;
create or replace function public.set_admin_password(target_id uuid,new_password text)
returns void language plpgsql security definer set search_path='public' as $$
begin
  if char_length(new_password)<10 or char_length(new_password)>72 then raise exception 'password length invalid'; end if;
  update public.administrators set password_hash=extensions.crypt(new_password,extensions.gen_salt('bf',12)),must_change_password=false,updated_at=now() where id=target_id;
  delete from public.admin_sessions where administrator_id=target_id;
end $$;
revoke all on function public.verify_admin_password(text,text),public.set_admin_password(uuid,text) from public,anon,authenticated;
grant execute on function public.verify_admin_password(text,text),public.set_admin_password(uuid,text) to service_role;

create or replace function public.create_class(class_name text)
returns public.classes language plpgsql security definer set search_path='public' as $$
declare result public.classes; code text;
begin
  if auth.uid() is null or not public.is_active_teacher(auth.uid()) then raise exception 'registered teacher required'; end if;
  loop code:=public.make_join_code(); begin insert into public.classes(teacher_id,name,join_code) values(auth.uid(),class_name,code) returning * into result; return result; exception when unique_violation then null; end; end loop;
end $$;

drop policy if exists "teachers manage own classes" on public.classes;
create policy "teachers manage own classes" on public.classes for all to authenticated using (teacher_id=auth.uid() and public.is_active_teacher()) with check (teacher_id=auth.uid() and public.is_active_teacher());
drop policy if exists "teachers view class students" on public.students;
create policy "teachers view class students" on public.students for select to authenticated using (public.is_active_teacher() and exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()));
drop policy if exists "teachers delete class students" on public.students;
create policy "teachers delete class students" on public.students for delete to authenticated using (public.is_active_teacher() and exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()));
drop policy if exists "teachers label class students" on public.students;
create policy "teachers label class students" on public.students for update to authenticated using (public.is_active_teacher() and exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid())) with check (public.is_active_teacher() and exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()));

-- Existing ownership policies remain the data boundary; this extra gate blocks disabled/unregistered users globally.
create policy "active teachers only projects" on public.research_projects as restrictive for all to authenticated using(public.is_active_teacher()) with check(public.is_active_teacher());
create policy "active teachers only events" on public.thought_events as restrictive for all to authenticated using(public.is_active_teacher()) with check(public.is_active_teacher());
create policy "active teachers only plans" on public.research_plans as restrictive for all to authenticated using(public.is_active_teacher()) with check(public.is_active_teacher());
create policy "active teachers only suggestions" on public.research_plan_suggestions as restrictive for all to authenticated using(public.is_active_teacher()) with check(public.is_active_teacher());
create policy "active teachers only experiments" on public.experiment_records as restrictive for all to authenticated using(public.is_active_teacher()) with check(public.is_active_teacher());
