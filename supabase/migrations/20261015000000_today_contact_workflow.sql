-- =============================================================================
-- Vleeds P1-E7 — Today queue + manual contact workflow
--
--   workspaces.timezone       IANA zone that defines "today" for the workspace
--   save_lead_score_trusted   score persistence for the server's trusted role
--                             only (closes the P1-E6 direct-RPC follow-up)
--   contact_attempts          append-only history of manual phone attempts
--   follow_up_tasks           callbacks / follow-ups / retries; at most ONE open
--                             task per contact (its next action)
--   record_contact_attempt    attempt + source task completion + next task +
--                             do-not-contact restriction, in one transaction
--   schedule / reschedule / complete / cancel_follow_up
--   today_ready_candidates    current A/B companies (default ICP) + contact facts
--   today_due_tasks           open tasks due before a given instant + facts
--
-- Timestamps stay timestamptz (UTC). The workspace timezone is only used by the
-- application for day boundaries, display and datetime input. Ready
-- eligibility, contact selection and due classification are decided by the
-- application's pure workflow module (src/lib/contact-workflow); these
-- functions return the facts. Scoring inputs are unchanged: attempts, tasks
-- and dispositions are NOT part of public.scoring_input().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Workspace timezone
-- -----------------------------------------------------------------------------
alter table public.workspaces
  add column timezone text not null default 'UTC'
    constraint workspaces_timezone_shape check (
      char_length(timezone) between 1 and 64 and timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$');

comment on column public.workspaces.timezone is
  'IANA time zone (e.g. UTC, Europe/London). Defines the workspace-local day for Today, callbacks and follow-ups.';

-- Only names the database knows as time zones (abbreviations/offset strings are rejected by the shape check).
create or replace function private.guard_workspace_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'unknown time zone' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_workspace_timezone() from public, anon;

create trigger workspaces_timezone_valid before insert or update of timezone on public.workspaces
  for each row execute function private.guard_workspace_timezone();

-- Owners/admins already pass workspaces_update_admin; members can read it.
grant update (timezone) on table public.workspaces to authenticated;

-- -----------------------------------------------------------------------------
-- Score persistence: trusted server role only
-- -----------------------------------------------------------------------------
-- Membership of an explicit user (the trusted function runs without a user JWT).
create or replace function private.user_is_workspace_member(p_user_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
      from public.workspaces w
      join public.memberships m on m.organization_id = w.organization_id
     where w.id = p_workspace_id and w.archived_at is null and m.user_id = p_user_id);
$$;
revoke all on function private.user_is_workspace_member(uuid, uuid) from public, anon, authenticated;

alter table public.lead_scores
  add column scored_by uuid references auth.users (id) on delete set null;

comment on column public.lead_scores.scored_by is
  'The authenticated user whose server request produced this result (passed by the trusted server writer).';

-- The P1-E6 function was executable by every authenticated member, who could
-- submit fabricated values that matched the current fingerprint. It is replaced
-- by a function only the server's trusted role may execute.
drop function public.save_lead_score(uuid, uuid, uuid, integer, text, text, integer, text, jsonb, integer, jsonb, jsonb, jsonb);

create function public.save_lead_score_trusted(
  p_actor_user_id     uuid,
  p_workspace_id      uuid,
  p_company_id        uuid,
  p_icp_profile_id    uuid,
  p_icp_revision      integer,
  p_input_fingerprint text,
  p_status            text,
  p_score             integer,
  p_grade             text,
  p_breakdown         jsonb,
  p_coverage_percent  integer,
  p_explanation       jsonb,
  p_effective_weights jsonb,
  p_exclusion_reasons jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_now     text;
  v_a       integer;
  v_b       integer;
  v_id      uuid;
begin
  -- Being called by the trusted role is not enough: the acting user must be a member.
  if not private.user_is_workspace_member(p_actor_user_id, p_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  select pr.revision, pr.scoring_model into v_profile
    from public.icp_profiles pr
   where pr.id = p_icp_profile_id and pr.workspace_id = p_workspace_id and pr.archived_at is null;
  if not found or not exists (select 1 from public.companies c
                               where c.id = p_company_id and c.workspace_id = p_workspace_id and c.archived_at is null) then
    raise exception 'company or profile not available' using errcode = '42501';
  end if;
  if v_profile.revision <> p_icp_revision then
    raise exception 'the profile changed; evaluate again' using errcode = '55000';
  end if;
  v_now := public.scoring_input(p_workspace_id, p_company_id, p_icp_profile_id) ->> 'fingerprint';
  if v_now is distinct from p_input_fingerprint then
    raise exception 'the scoring inputs changed; evaluate again' using errcode = '55000';
  end if;
  if p_status not in ('scored', 'excluded') then
    raise exception 'unsupported outcome' using errcode = '22023';
  end if;
  if p_coverage_percent is null or p_coverage_percent not between 0 and 100 then
    raise exception 'coverage out of range' using errcode = '23514';
  end if;
  if p_status = 'scored' then
    if p_score is null or p_score not between 0 and 100 then
      raise exception 'score out of range' using errcode = '23514';
    end if;
    v_a := (v_profile.scoring_model -> 'thresholds' ->> 'a')::integer;
    v_b := (v_profile.scoring_model -> 'thresholds' ->> 'b')::integer;
    if p_grade is distinct from (case when p_score >= v_a then 'A' when p_score >= v_b then 'B' else 'C' end) then
      raise exception 'grade does not follow the profile thresholds' using errcode = '23514';
    end if;
  else
    -- An exclusion names at least one reason and carries no score or grade.
    if p_score is not null or p_grade is not null or jsonb_typeof(p_exclusion_reasons) is distinct from 'array'
       or jsonb_array_length(p_exclusion_reasons) < 1
       or exists (select 1 from jsonb_array_elements(p_exclusion_reasons) r
                   where jsonb_typeof(r) <> 'object' or jsonb_typeof(r -> 'name') is distinct from 'string') then
      raise exception 'an exclusion needs reasons and no score' using errcode = '23514';
    end if;
  end if;

  insert into public.lead_scores as s (workspace_id, company_id, icp_profile_id, icp_revision, score, grade, breakdown, status,
                                       scored_at, input_fingerprint, coverage_percent, explanation, effective_weights,
                                       exclusion_reasons, scored_by)
  values (p_workspace_id, p_company_id, p_icp_profile_id, p_icp_revision, p_score, p_grade, p_breakdown, p_status, now(),
          p_input_fingerprint, p_coverage_percent, p_explanation, p_effective_weights, p_exclusion_reasons, p_actor_user_id)
  on conflict (company_id, icp_profile_id, icp_revision) do update set
    score = excluded.score, grade = excluded.grade, breakdown = excluded.breakdown, status = excluded.status,
    scored_at = excluded.scored_at, input_fingerprint = excluded.input_fingerprint,
    coverage_percent = excluded.coverage_percent, explanation = excluded.explanation,
    effective_weights = excluded.effective_weights, exclusion_reasons = excluded.exclusion_reasons,
    scored_by = excluded.scored_by
  returning s.id into v_id;
  return v_id;
end;
$$;

revoke all on function public.save_lead_score_trusted(uuid, uuid, uuid, uuid, integer, text, text, integer, text, jsonb, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_lead_score_trusted(uuid, uuid, uuid, uuid, integer, text, text, integer, text, jsonb, integer, jsonb, jsonb, jsonb)
  to service_role;

-- -----------------------------------------------------------------------------
-- contact_attempts (history) and follow_up_tasks (next actions)
-- -----------------------------------------------------------------------------
create table public.contact_attempts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  company_id      uuid not null,
  contact_id      uuid not null,
  source_task_id  uuid,
  -- Retry safety: one attempt per submitted outcome form.
  request_id      uuid not null,
  channel         text not null default 'phone' check (channel in ('phone')),
  disposition     text not null check (disposition in ('no_answer', 'left_voicemail', 'connected_interested',
                                                       'connected_not_interested', 'callback_requested', 'follow_up_needed',
                                                       'wrong_number', 'do_not_contact', 'other')),
  note            text check (note is null or char_length(note) between 1 and 1000),
  attempted_at    timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint contact_attempts_identity unique (workspace_id, company_id, contact_id, id),
  constraint contact_attempts_request unique (workspace_id, request_id),
  constraint contact_attempts_contact_fk foreign key (workspace_id, company_id, contact_id)
    references public.contacts (workspace_id, company_id, id) on delete cascade,
  constraint contact_attempts_other_note check (disposition <> 'other' or note is not null)
);

comment on table public.contact_attempts is
  'Manual contact attempts (P1-E7: phone). Historical events: appended through record_contact_attempt, never edited.';

create table public.follow_up_tasks (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  company_id         uuid not null,
  contact_id         uuid not null,
  source_attempt_id  uuid,
  kind               text not null check (kind in ('callback', 'follow_up', 'retry_call')),
  due_at             timestamptz not null,
  status             text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  note               text check (note is null or char_length(note) between 1 and 1000),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz,
  completed_by       uuid references auth.users (id) on delete set null,
  cancelled_at       timestamptz,
  cancelled_by       uuid references auth.users (id) on delete set null,
  constraint follow_up_tasks_identity unique (workspace_id, company_id, contact_id, id),
  constraint follow_up_tasks_contact_fk foreign key (workspace_id, company_id, contact_id)
    references public.contacts (workspace_id, company_id, id) on delete cascade,
  -- The attempt that created this task is the same contact's.
  constraint follow_up_tasks_source_attempt_fk foreign key (workspace_id, company_id, contact_id, source_attempt_id)
    references public.contact_attempts (workspace_id, company_id, contact_id, id),
  constraint follow_up_tasks_status_times check (
    (status = 'open' and completed_at is null and cancelled_at is null)
    or (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null))
);

comment on table public.follow_up_tasks is
  'A contact''s scheduled next action. At most one open task per contact; completed/cancelled tasks remain as history.';

-- The task an attempt completed is the same contact's.
alter table public.contact_attempts
  add constraint contact_attempts_source_task_fk foreign key (workspace_id, company_id, contact_id, source_task_id)
    references public.follow_up_tasks (workspace_id, company_id, contact_id, id);

-- One clear next action per contact.
create unique index follow_up_tasks_one_open_per_contact on public.follow_up_tasks (contact_id) where status = 'open';
create index follow_up_tasks_workspace_open_due_idx on public.follow_up_tasks (workspace_id, due_at) where status = 'open';
create index follow_up_tasks_company_created_idx on public.follow_up_tasks (company_id, created_at desc);
create index contact_attempts_company_attempted_idx on public.contact_attempts (company_id, attempted_at desc);
create index contact_attempts_contact_attempted_idx on public.contact_attempts (contact_id, attempted_at desc);
create index contact_attempts_workspace_attempted_idx on public.contact_attempts (workspace_id, attempted_at desc);

create trigger follow_up_tasks_set_updated_at before update on public.follow_up_tasks
  for each row execute function private.set_updated_at();
create trigger follow_up_tasks_keys_immutable before update on public.follow_up_tasks
  for each row execute function private.prevent_tenant_key_change(
    'workspace_id', 'company_id', 'contact_id', 'source_attempt_id', 'kind', 'created_by', 'created_at');

-- Attempts are history: no edits, whoever asks.
create or replace function private.prevent_attempt_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'contact attempts are history and cannot be edited' using errcode = '42501';
end;
$$;
revoke all on function private.prevent_attempt_update() from public, anon;
create trigger contact_attempts_no_update before update on public.contact_attempts
  for each row execute function private.prevent_attempt_update();

-- Read-only for API roles: every write goes through the functions below.
revoke all on table public.contact_attempts, public.follow_up_tasks from public, anon, authenticated;
grant select on table public.contact_attempts, public.follow_up_tasks to authenticated;
grant all on table public.contact_attempts, public.follow_up_tasks to service_role;

alter table public.contact_attempts enable row level security;
alter table public.follow_up_tasks  enable row level security;
create policy contact_attempts_select_member on public.contact_attempts for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy follow_up_tasks_select_member on public.follow_up_tasks for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- -----------------------------------------------------------------------------
-- Workflow functions (act as auth.uid(); explicit membership + relationship checks)
-- -----------------------------------------------------------------------------
-- Error codes surfaced to the application:
--   42501 not a member / record not available     VL001 company or contact restricted
--   VL002 contact can't be contacted (left company, no phone)
--   VL003 task isn't open (or isn't this contact's)  VL004 the contact already has an open task
--   22023 invalid request (disposition rules, due time)

-- Why a contact can't receive a normal phone action now (NULL = contactable).
create or replace function private.contact_blocker(p_workspace_id uuid, p_company_id uuid, p_contact_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.id is null or c.archived_at is not null then 'company_unavailable'
    when k.id is null or k.archived_at is not null then 'contact_unavailable'
    when exists (select 1 from public.suppression_records r
                  where r.workspace_id = p_workspace_id and r.company_id = p_company_id and r.scope = 'company' and r.active)
      then 'company_restricted'
    when exists (select 1 from public.suppression_records r
                  where r.workspace_id = p_workspace_id and r.company_id = p_company_id and r.scope = 'contact'
                    and r.contact_id = p_contact_id and r.active)
      then 'contact_restricted'
    when k.status = 'left_company' then 'contact_left'
    when k.phone is null or btrim(k.phone) = '' then 'no_phone'
  end
    from (select 1) one
    left join public.companies c on c.id = p_company_id and c.workspace_id = p_workspace_id
    left join public.contacts k on k.id = p_contact_id and k.company_id = p_company_id and k.workspace_id = p_workspace_id;
$$;
revoke all on function private.contact_blocker(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.raise_blocker(p_blocker text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_blocker in ('company_restricted', 'contact_restricted') then
    raise exception '%', p_blocker using errcode = 'VL001';
  elsif p_blocker in ('company_unavailable', 'contact_unavailable') then
    raise exception '%', p_blocker using errcode = '42501';
  elsif p_blocker is not null then
    raise exception '%', p_blocker using errcode = 'VL002';
  end if;
end;
$$;
revoke all on function private.raise_blocker(text) from public, anon, authenticated;

create or replace function private.check_due_at(p_due_at timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_due_at is null or p_due_at <= now() or p_due_at > now() + interval '5 years' then
    raise exception 'choose a future date and time' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.check_due_at(timestamptz) from public, anon, authenticated;

-- Records one manual attempt and its consequences atomically.
create or replace function public.record_contact_attempt(
  p_workspace_id       uuid,
  p_company_id         uuid,
  p_contact_id         uuid,
  p_request_id         uuid,
  p_disposition        text,
  p_note               text default null,
  p_source_task_id     uuid default null,
  p_next_kind          text default null,
  p_next_due_at        timestamptz default null,
  p_next_note          text default null,
  p_suppression_scope  text default null,
  p_suppression_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := auth.uid();
  v_existing  record;
  v_task      record;
  v_blocker   text;
  v_allowed   text[];
  v_attempt   uuid;
  v_next      uuid;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_next_note text := nullif(btrim(coalesce(p_next_note, '')), '');
  v_reason    text := nullif(btrim(coalesce(p_suppression_reason, '')), '');
begin
  if v_actor is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request id required' using errcode = '22023';
  end if;

  -- Retry-safe: a resubmitted form returns what it already recorded.
  select a.id, a.contact_id into v_existing
    from public.contact_attempts a
   where a.workspace_id = p_workspace_id and a.request_id = p_request_id;
  if found then
    if v_existing.contact_id <> p_contact_id then
      raise exception 'request id already used' using errcode = '22023';
    end if;
    return jsonb_build_object('attempt_id', v_existing.id, 'replayed', true,
      'task_id', (select t.id from public.follow_up_tasks t where t.source_attempt_id = v_existing.id limit 1));
  end if;

  -- Serialize workflow changes for this contact.
  perform 1 from public.contacts k
   where k.id = p_contact_id and k.company_id = p_company_id and k.workspace_id = p_workspace_id
     for update;
  if not found then
    raise exception 'contact not available' using errcode = '42501';
  end if;

  if p_disposition is null or p_disposition not in ('no_answer', 'left_voicemail', 'connected_interested',
       'connected_not_interested', 'callback_requested', 'follow_up_needed', 'wrong_number', 'do_not_contact', 'other') then
    raise exception 'unsupported disposition' using errcode = '22023';
  end if;

  -- Restricted targets get no new attempts. "Do not contact" is allowed on a
  -- contactable record because it creates the restriction.
  v_blocker := private.contact_blocker(p_workspace_id, p_company_id, p_contact_id);
  if not (p_disposition = 'do_not_contact' and v_blocker = 'no_phone') then
    perform private.raise_blocker(v_blocker);
  end if;

  v_allowed := case p_disposition
    when 'no_answer' then array['retry_call']
    when 'left_voicemail' then array['retry_call']
    when 'connected_interested' then array['follow_up']
    when 'callback_requested' then array['callback']
    when 'follow_up_needed' then array['follow_up']
    when 'other' then array['callback', 'follow_up', 'retry_call']
    else array[]::text[] end;
  if p_disposition in ('callback_requested', 'follow_up_needed') and (p_next_kind is null or p_next_due_at is null) then
    raise exception 'a due date and time are required' using errcode = '22023';
  end if;
  if (p_next_kind is null) <> (p_next_due_at is null) or (p_next_kind is not null and not (p_next_kind = any (v_allowed))) then
    raise exception 'this outcome can''t schedule that next action' using errcode = '22023';
  end if;
  if p_next_kind is not null then
    perform private.check_due_at(p_next_due_at);
  end if;
  if p_disposition = 'other' and v_note is null then
    raise exception 'a note is required' using errcode = '22023';
  end if;
  if (p_disposition = 'do_not_contact') <> (p_suppression_scope is not null)
     or (p_suppression_scope is not null and p_suppression_scope not in ('contact', 'company')) then
    raise exception 'do not contact needs a scope' using errcode = '22023';
  end if;

  if p_source_task_id is not null then
    select t.id, t.status into v_task
      from public.follow_up_tasks t
     where t.id = p_source_task_id and t.workspace_id = p_workspace_id
       and t.company_id = p_company_id and t.contact_id = p_contact_id
       for update;
    if not found or v_task.status <> 'open' then
      raise exception 'the task is no longer open' using errcode = 'VL003';
    end if;
  end if;

  insert into public.contact_attempts (workspace_id, company_id, contact_id, source_task_id, request_id, channel, disposition,
                                       note, attempted_at, created_by)
  values (p_workspace_id, p_company_id, p_contact_id, p_source_task_id, p_request_id, 'phone', p_disposition, v_note, now(), v_actor)
  returning id into v_attempt;

  if p_source_task_id is not null then
    update public.follow_up_tasks
       set status = 'completed', completed_at = now(), completed_by = v_actor
     where id = p_source_task_id;
  end if;

  if p_next_kind is not null then
    -- One next action per contact: a remaining open task is replaced.
    update public.follow_up_tasks
       set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor
     where workspace_id = p_workspace_id and contact_id = p_contact_id and status = 'open';
    insert into public.follow_up_tasks (workspace_id, company_id, contact_id, source_attempt_id, kind, due_at, note, created_by)
    values (p_workspace_id, p_company_id, p_contact_id, v_attempt, p_next_kind, p_next_due_at, v_next_note, v_actor)
    returning id into v_next;
  end if;

  if p_disposition = 'do_not_contact' then
    insert into public.suppression_records (workspace_id, company_id, contact_id, scope, reason, created_by)
    values (p_workspace_id, p_company_id, case when p_suppression_scope = 'contact' then p_contact_id end,
            p_suppression_scope, v_reason, v_actor)
    on conflict do nothing;
    update public.follow_up_tasks
       set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor
     where workspace_id = p_workspace_id and company_id = p_company_id and status = 'open'
       and (p_suppression_scope = 'company' or contact_id = p_contact_id);
  end if;

  return jsonb_build_object('attempt_id', v_attempt, 'task_id', v_next, 'replayed', false);
end;
$$;

revoke all on function public.record_contact_attempt(uuid, uuid, uuid, uuid, text, text, uuid, text, timestamptz, text, text, text)
  from public, anon;
grant execute on function public.record_contact_attempt(uuid, uuid, uuid, uuid, text, text, uuid, text, timestamptz, text, text, text)
  to authenticated, service_role;

-- Schedules a contact's next action. A contact with an open task must reschedule it instead.
create or replace function public.schedule_follow_up(
  p_workspace_id uuid,
  p_company_id   uuid,
  p_contact_id   uuid,
  p_kind         text,
  p_due_at       timestamptz,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  perform 1 from public.contacts k
   where k.id = p_contact_id and k.company_id = p_company_id and k.workspace_id = p_workspace_id
     for update;
  if not found then
    raise exception 'contact not available' using errcode = '42501';
  end if;
  perform private.raise_blocker(private.contact_blocker(p_workspace_id, p_company_id, p_contact_id));
  if p_kind is null or p_kind not in ('callback', 'follow_up', 'retry_call') then
    raise exception 'unsupported task kind' using errcode = '22023';
  end if;
  perform private.check_due_at(p_due_at);
  if exists (select 1 from public.follow_up_tasks t where t.contact_id = p_contact_id and t.status = 'open') then
    raise exception 'this contact already has an open task' using errcode = 'VL004';
  end if;
  insert into public.follow_up_tasks (workspace_id, company_id, contact_id, kind, due_at, note, created_by)
  values (p_workspace_id, p_company_id, p_contact_id, p_kind, p_due_at, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Moves an open task to a new due time (same task, creator and created_at).
create or replace function public.reschedule_follow_up(p_workspace_id uuid, p_task_id uuid, p_due_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task record;
begin
  if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  select t.status, t.company_id, t.contact_id into v_task
    from public.follow_up_tasks t where t.id = p_task_id and t.workspace_id = p_workspace_id for update;
  if not found then
    raise exception 'task not available' using errcode = '42501';
  end if;
  if v_task.status <> 'open' then
    raise exception 'the task is no longer open' using errcode = 'VL003';
  end if;
  perform private.raise_blocker(private.contact_blocker(p_workspace_id, v_task.company_id, v_task.contact_id));
  perform private.check_due_at(p_due_at);
  update public.follow_up_tasks set due_at = p_due_at where id = p_task_id;
end;
$$;

-- Closes an open task without a contact attempt (handled elsewhere / no longer needed),
-- or cancels it. Allowed for blocked tasks, so restricted work can be cleared.
create or replace function private.close_follow_up(p_workspace_id uuid, p_task_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  select t.status into v_status from public.follow_up_tasks t
   where t.id = p_task_id and t.workspace_id = p_workspace_id for update;
  if not found then
    raise exception 'task not available' using errcode = '42501';
  end if;
  if v_status <> 'open' then
    raise exception 'the task is no longer open' using errcode = 'VL003';
  end if;
  if p_status = 'completed' then
    update public.follow_up_tasks set status = 'completed', completed_at = now(), completed_by = auth.uid() where id = p_task_id;
  else
    update public.follow_up_tasks set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid() where id = p_task_id;
  end if;
end;
$$;
revoke all on function private.close_follow_up(uuid, uuid, text) from public, anon;
grant execute on function private.close_follow_up(uuid, uuid, text) to authenticated, service_role;

create or replace function public.complete_follow_up(p_workspace_id uuid, p_task_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.close_follow_up(p_workspace_id, p_task_id, 'completed');
$$;

create or replace function public.cancel_follow_up(p_workspace_id uuid, p_task_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.close_follow_up(p_workspace_id, p_task_id, 'cancelled');
$$;

revoke all on function public.schedule_follow_up(uuid, uuid, uuid, text, timestamptz, text) from public, anon;
revoke all on function public.reschedule_follow_up(uuid, uuid, timestamptz) from public, anon;
revoke all on function public.complete_follow_up(uuid, uuid) from public, anon;
revoke all on function public.cancel_follow_up(uuid, uuid) from public, anon;
grant execute on function public.schedule_follow_up(uuid, uuid, uuid, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.reschedule_follow_up(uuid, uuid, timestamptz) to authenticated, service_role;
grant execute on function public.complete_follow_up(uuid, uuid) to authenticated, service_role;
grant execute on function public.cancel_follow_up(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Today reads (security invoker: RLS applies)
-- -----------------------------------------------------------------------------
-- Companies whose CURRENT default-ICP result is grade A or B (same currentness
-- rule as list_companies: current revision AND current fingerprint), with the
-- facts the application needs to decide Ready eligibility and pick a contact.
-- Ordered A before B, fit descending, then name/id. Bounded.
create or replace function public.today_ready_candidates(p_workspace_id uuid, p_limit integer default 2000)
returns table (
  company_id uuid, canonical_name text, location jsonb, qualification_state text, company_restricted boolean,
  grade text, score integer, coverage_percent integer, contacts jsonb, last_attempt jsonb, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with dp as (
    select pr.id, pr.revision
      from public.icp_profiles pr
     where pr.workspace_id = p_workspace_id and pr.is_default and pr.archived_at is null
     limit 1
  ),
  cur as (
    select c.id, c.canonical_name, c.normalized_name, c.location, c.qualification_state, s.grade, s.score, s.coverage_percent
      from public.companies c
      join dp on true
      join public.lead_scores s
        on s.company_id = c.id and s.workspace_id = c.workspace_id and s.icp_profile_id = dp.id
       and s.icp_revision = dp.revision and s.status = 'scored'
     where c.workspace_id = p_workspace_id and c.archived_at is null and s.grade in ('A', 'B')
       and s.input_fingerprint = (public.scoring_input(p_workspace_id, c.id, dp.id) ->> 'fingerprint')
  )
  select cur.id, cur.canonical_name, cur.location, cur.qualification_state,
         exists (select 1 from public.suppression_records r
                  where r.workspace_id = p_workspace_id and r.company_id = cur.id and r.scope = 'company' and r.active),
         cur.grade, cur.score, cur.coverage_percent,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', k.id, 'full_name', k.full_name, 'job_title', k.job_title, 'phone', k.phone,
                    'is_primary', k.is_primary, 'status', k.status,
                    'restricted', exists (select 1 from public.suppression_records r
                                           where r.workspace_id = p_workspace_id and r.company_id = cur.id
                                             and r.scope = 'contact' and r.contact_id = k.id and r.active),
                    'open_task_due_at', (select t.due_at from public.follow_up_tasks t
                                          where t.workspace_id = p_workspace_id and t.contact_id = k.id and t.status = 'open'),
                    'latest_attempt', (select jsonb_build_object('disposition', a.disposition, 'attempted_at', a.attempted_at)
                                         from public.contact_attempts a
                                        where a.workspace_id = p_workspace_id and a.contact_id = k.id
                                        order by a.attempted_at desc, a.created_at desc limit 1))
                  order by k.created_at, k.id)
             from public.contacts k
            where k.workspace_id = p_workspace_id and k.company_id = cur.id and k.archived_at is null), '[]'::jsonb),
         (select jsonb_build_object('disposition', a.disposition, 'attempted_at', a.attempted_at, 'contact_name', k.full_name)
            from public.contact_attempts a
            join public.contacts k on k.id = a.contact_id
           where a.workspace_id = p_workspace_id and a.company_id = cur.id
           order by a.attempted_at desc, a.created_at desc limit 1),
         count(*) over ()
    from cur
   order by array_position(array['A', 'B'], cur.grade), cur.score desc, cur.normalized_name, cur.id
   limit least(greatest(coalesce(p_limit, 2000), 1), 2000);
$$;

-- Open tasks due before p_until (normally the end of the workspace-local day),
-- with what's needed to show them and to tell whether they are blocked.
create or replace function public.today_due_tasks(p_workspace_id uuid, p_until timestamptz, p_limit integer default 200)
returns table (
  id uuid, kind text, due_at timestamptz, note text, created_at timestamptz,
  company_id uuid, company_name text, company_archived boolean, company_restricted boolean,
  contact_id uuid, contact_name text, job_title text, phone text, contact_status text, contact_archived boolean,
  contact_restricted boolean, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.kind, t.due_at, t.note, t.created_at,
         c.id, c.canonical_name, c.archived_at is not null,
         exists (select 1 from public.suppression_records r
                  where r.workspace_id = p_workspace_id and r.company_id = c.id and r.scope = 'company' and r.active),
         k.id, k.full_name, k.job_title, k.phone, k.status, k.archived_at is not null,
         exists (select 1 from public.suppression_records r
                  where r.workspace_id = p_workspace_id and r.company_id = c.id and r.scope = 'contact'
                    and r.contact_id = k.id and r.active),
         count(*) over ()
    from public.follow_up_tasks t
    join public.companies c on c.id = t.company_id and c.workspace_id = t.workspace_id
    join public.contacts k on k.id = t.contact_id and k.workspace_id = t.workspace_id
   where t.workspace_id = p_workspace_id and t.status = 'open' and t.due_at < p_until
   order by t.due_at, t.id
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

revoke all on function public.today_ready_candidates(uuid, integer) from public, anon;
revoke all on function public.today_due_tasks(uuid, timestamptz, integer) from public, anon;
grant execute on function public.today_ready_candidates(uuid, integer) to authenticated, service_role;
grant execute on function public.today_due_tasks(uuid, timestamptz, integer) to authenticated, service_role;
