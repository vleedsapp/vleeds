-- =============================================================================
-- Vleeds P1-E6 — Deterministic ICP evaluation + lead scoring
--
-- companies ─< company_signal_observations >── icp_profiles (profile + revision)
-- companies ─< lead_scores >── icp_profiles (profile + revision) + input fingerprint
--
-- * company_signal_observations: a person's structured assessment of ONE
--   configured buying/exclusion signal for ONE company under ONE ICP revision
--   (present | absent). Unknown = no row.
-- * public.scoring_input(): THE canonical scoring input document (only
--   durable Vleeds facts that affect scoring) and its SHA-256 fingerprint. The
--   server evaluates exactly this document (pure TypeScript engine,
--   src/lib/scoring); list_companies uses the same function to tell current
--   from outdated scores. One definition, no mutation triggers.
-- * public.save_lead_score(): the only write path for scores. It refuses a
--   result whose revision or fingerprint is not current, or whose grade does
--   not follow the profile's thresholds.
-- * lead_scores gains fingerprint, coverage, explanation, effective weights,
--   exclusion reasons and the 'excluded' outcome.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- company_signal_observations
-- -----------------------------------------------------------------------------
create table public.company_signal_observations (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  company_id          uuid not null,
  icp_profile_id      uuid not null,
  icp_revision        integer not null check (icp_revision >= 1),
  signal_kind         text not null check (signal_kind in ('buying', 'exclusion')),
  signal_id           uuid not null,
  state               text not null check (state in ('present', 'absent')),
  note                text check (note is null or char_length(btrim(note)) between 1 and 500),
  source_evidence_id  uuid,
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  observed_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint company_signal_observations_company_fk foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete cascade,
  constraint company_signal_observations_profile_fk foreign key (workspace_id, icp_profile_id)
    references public.icp_profiles (workspace_id, id) on delete cascade,
  constraint company_signal_observations_evidence_fk foreign key (source_evidence_id)
    references public.lead_sources (id) on delete set null,
  constraint company_signal_observations_one_per_signal unique (company_id, icp_profile_id, icp_revision, signal_kind, signal_id)
);

comment on table public.company_signal_observations is
  'Structured assessment of a configured ICP signal for a company under one ICP revision (present/absent; unknown = no row). '
  'Manually confirmed in P1-E6; never inferred from free text.';

create index company_signal_observations_company_idx on public.company_signal_observations (company_id, icp_profile_id, icp_revision);

-- A signal must exist, with that kind, in the profile's CURRENT configuration
-- when it is recorded (rows of older revisions stay readable as history), and
-- any linked evidence must belong to the same company and workspace.
create or replace function private.guard_signal_observation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_revision integer;
  v_list     jsonb;
  v_ok       boolean;
begin
  select p.revision, case when new.signal_kind = 'buying' then p.buying_signals else p.exclusion_signals end
    into v_revision, v_list
    from public.icp_profiles p
   where p.id = new.icp_profile_id and p.workspace_id = new.workspace_id;
  if v_revision is distinct from new.icp_revision then
    raise exception 'observations are recorded for the current profile revision only' using errcode = '55000';
  end if;
  if v_list is null or jsonb_typeof(v_list) <> 'array'
     or not exists (select 1 from jsonb_array_elements(v_list) s where s ->> 'id' = new.signal_id::text) then
    raise exception 'signal is not part of this profile revision' using errcode = '23514';
  end if;
  if new.source_evidence_id is not null then
    select exists (select 1 from public.lead_sources ls
                    where ls.id = new.source_evidence_id and ls.workspace_id = new.workspace_id and ls.company_id = new.company_id)
      into v_ok;
    if not v_ok then
      raise exception 'evidence must belong to this company' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.observed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.guard_signal_observation() from public, anon;

create trigger company_signal_observations_guard before insert or update on public.company_signal_observations
  for each row execute function private.guard_signal_observation();
create trigger company_signal_observations_set_updated_at before update on public.company_signal_observations
  for each row execute function private.set_updated_at();
create trigger company_signal_observations_keys_immutable before update on public.company_signal_observations
  for each row execute function private.prevent_tenant_key_change(
    'workspace_id', 'company_id', 'icp_profile_id', 'icp_revision', 'signal_kind', 'signal_id', 'created_by');

revoke all on table public.company_signal_observations from public, anon, authenticated;
grant select, delete on table public.company_signal_observations to authenticated;
grant insert (workspace_id, company_id, icp_profile_id, icp_revision, signal_kind, signal_id, state, note, source_evidence_id)
  on table public.company_signal_observations to authenticated;
grant update (state, note, source_evidence_id) on table public.company_signal_observations to authenticated;
grant all on table public.company_signal_observations to service_role;

alter table public.company_signal_observations enable row level security;
create policy company_signal_observations_select_member on public.company_signal_observations for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy company_signal_observations_insert_member on public.company_signal_observations for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy company_signal_observations_update_member on public.company_signal_observations for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
-- "Unknown" removes the observation (unknown is represented by no row).
create policy company_signal_observations_delete_member on public.company_signal_observations for delete to authenticated
  using (private.is_workspace_member(workspace_id));

-- -----------------------------------------------------------------------------
-- lead_scores: outcome, fingerprint, coverage, explanation
-- -----------------------------------------------------------------------------
-- Results from before the scoring engine have no fingerprint: they can't be
-- current, so they become stale (readable history).
alter table public.lead_scores drop constraint lead_scores_scored_complete;
update public.lead_scores set status = 'stale' where status = 'scored';

alter table public.lead_scores
  add column input_fingerprint text check (input_fingerprint is null or input_fingerprint ~ '^[0-9a-f]{64}$'),
  add column coverage_percent  integer check (coverage_percent is null or coverage_percent between 0 and 100),
  add column explanation       jsonb check (explanation is null or (jsonb_typeof(explanation) = 'object' and octet_length(explanation::text) <= 16384)),
  add column effective_weights jsonb check (effective_weights is null or (jsonb_typeof(effective_weights) = 'object' and octet_length(effective_weights::text) <= 1024)),
  add column exclusion_reasons jsonb check (exclusion_reasons is null or (jsonb_typeof(exclusion_reasons) = 'array'
                                           and jsonb_array_length(exclusion_reasons) <= 50 and octet_length(exclusion_reasons::text) <= 4096)),
  drop constraint lead_scores_status_check,
  add constraint lead_scores_status_check check (status in ('pending', 'scored', 'stale', 'excluded')),
  add constraint lead_scores_scored_complete check (
    status <> 'scored' or (score is not null and grade is not null and scored_at is not null
                           and input_fingerprint is not null and coverage_percent is not null)),
  -- A hard exclusion is an outcome, never a fake grade.
  add constraint lead_scores_excluded_complete check (
    status <> 'excluded' or (score is null and grade is null and scored_at is not null and input_fingerprint is not null
                             and coverage_percent is not null and exclusion_reasons is not null
                             and jsonb_array_length(exclusion_reasons) >= 1));

comment on column public.lead_scores.input_fingerprint is
  'SHA-256 of public.scoring_input() at evaluation time. Current = same ICP revision AND same fingerprint as now.';

-- -----------------------------------------------------------------------------
-- scoring_input: the canonical scoring input document + fingerprint
-- -----------------------------------------------------------------------------
-- Only durable facts that affect scoring, in a canonical order:
--   company: name, industry, description, employee range, country/region/city
--   tags:    company.tags evidence values (sorted, distinct)
--   contacts: titles of active contacts (not archived, not left_company), sorted
--   signals: observations for this profile's CURRENT revision, sorted
--   icp:     id, revision and the scoring-relevant configuration
-- jsonb text output is canonical (sorted keys), so equal inputs hash equally.
-- NULL when the company or profile isn't visible/active in the workspace.
create or replace function public.scoring_input(p_workspace_id uuid, p_company_id uuid, p_icp_profile_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (
    select x.id, x.canonical_name, x.industry, x.description, x.employee_count_min, x.employee_count_max, x.location
      from public.companies x
     where x.id = p_company_id and x.workspace_id = p_workspace_id and x.archived_at is null
  ), p as (
    select y.id, y.revision, y.ideal_customer, y.target_geographies, y.decision_maker_titles, y.buying_signals,
           y.exclusion_signals, y.scoring_model
      from public.icp_profiles y
     where y.id = p_icp_profile_id and y.workspace_id = p_workspace_id and y.archived_at is null
  ), doc as (
    select jsonb_build_object(
      'v', 1,
      'company', jsonb_build_object(
        'id', c.id, 'name', c.canonical_name, 'industry', c.industry, 'description', c.description,
        'employee_count_min', c.employee_count_min, 'employee_count_max', c.employee_count_max,
        'country', c.location ->> 'countryCode', 'region', c.location ->> 'region', 'city', c.location ->> 'city'),
      'tags', coalesce((
        select jsonb_agg(t.v order by t.v)
          from (select distinct ls.observed_value #>> '{}' as v
                  from public.lead_sources ls
                 where ls.workspace_id = p_workspace_id and ls.company_id = c.id and ls.contact_id is null
                   and ls.field_key = 'company.tags' and jsonb_typeof(ls.observed_value) = 'string') t), '[]'::jsonb),
      'contacts', coalesce((
        select jsonb_agg(jsonb_build_object('title', k.job_title) order by coalesce(k.job_title, ''))
          from public.contacts k
         where k.workspace_id = p_workspace_id and k.company_id = c.id and k.archived_at is null
           and k.status <> 'left_company'), '[]'::jsonb),
      'signals', coalesce((
        select jsonb_agg(jsonb_build_object('kind', o.signal_kind, 'id', o.signal_id, 'state', o.state)
                         order by o.signal_kind, o.signal_id)
          from public.company_signal_observations o
         where o.workspace_id = p_workspace_id and o.company_id = c.id and o.icp_profile_id = p.id
           and o.icp_revision = p.revision), '[]'::jsonb),
      'icp', jsonb_build_object(
        'id', p.id, 'revision', p.revision, 'ideal_customer', p.ideal_customer, 'target_geographies', p.target_geographies,
        'decision_maker_titles', p.decision_maker_titles, 'buying_signals', p.buying_signals,
        'exclusion_signals', p.exclusion_signals, 'scoring_model', p.scoring_model)
    ) as input
      from c, p
  )
  select jsonb_build_object('input', doc.input, 'fingerprint', encode(sha256(convert_to(doc.input::text, 'UTF8')), 'hex'))
    from doc;
$$;

revoke all on function public.scoring_input(uuid, uuid, uuid) from public, anon;
grant execute on function public.scoring_input(uuid, uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- save_lead_score: the only write path for scores
-- -----------------------------------------------------------------------------
-- Called by the server after evaluating scoring_input() with the scoring
-- engine. Refuses: non-members, foreign/archived company or profile, a
-- revision or fingerprint that is not current (inputs changed meanwhile), an
-- unknown outcome, and a grade that doesn't follow the profile's thresholds.
-- Re-evaluating the same company/profile/revision updates its row.
create or replace function public.save_lead_score(
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
  if not private.is_workspace_member(p_workspace_id) then
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
  if p_status = 'scored' then
    v_a := (v_profile.scoring_model -> 'thresholds' ->> 'a')::integer;
    v_b := (v_profile.scoring_model -> 'thresholds' ->> 'b')::integer;
    if p_score is null or p_grade is distinct from (case when p_score >= v_a then 'A' when p_score >= v_b then 'B' else 'C' end) then
      raise exception 'grade does not follow the profile thresholds' using errcode = '23514';
    end if;
  end if;

  insert into public.lead_scores as s (workspace_id, company_id, icp_profile_id, icp_revision, score, grade, breakdown, status,
                                       scored_at, input_fingerprint, coverage_percent, explanation, effective_weights,
                                       exclusion_reasons)
  values (p_workspace_id, p_company_id, p_icp_profile_id, p_icp_revision, p_score, p_grade, p_breakdown, p_status, now(),
          p_input_fingerprint, p_coverage_percent, p_explanation, p_effective_weights, p_exclusion_reasons)
  on conflict (company_id, icp_profile_id, icp_revision) do update set
    score = excluded.score, grade = excluded.grade, breakdown = excluded.breakdown, status = excluded.status,
    scored_at = excluded.scored_at, input_fingerprint = excluded.input_fingerprint,
    coverage_percent = excluded.coverage_percent, explanation = excluded.explanation,
    effective_weights = excluded.effective_weights, exclusion_reasons = excluded.exclusion_reasons
  returning s.id into v_id;
  return v_id;
end;
$$;

revoke all on function public.save_lead_score(uuid, uuid, uuid, integer, text, text, integer, text, jsonb, integer, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.save_lead_score(uuid, uuid, uuid, integer, text, text, integer, text, jsonb, integer, jsonb, jsonb, jsonb)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- list_companies: grade/fit from the default profile, CURRENT results only
-- -----------------------------------------------------------------------------
-- score_state: current (A/B/C) | excluded | outdated | none. A result is
-- current only for the default profile's current revision AND the current
-- scoring_input() fingerprint. Grade and score are returned only when current.
-- p_grade accepts A | B | C | excluded | outdated | none.
drop function public.list_companies(uuid, text, text, boolean, boolean, text, text, integer, integer);

create function public.list_companies(
  p_workspace_id  uuid,
  p_qualification text default null,
  p_grade         text default null,
  p_restricted    boolean default null,
  p_has_contact   boolean default null,
  p_country       text default null,
  p_sort          text default 'updated',
  p_limit         integer default 25,
  p_offset        integer default 0
)
returns table (
  id uuid, canonical_name text, primary_domain text, location jsonb, qualification_state text, updated_at timestamptz,
  grade text, score integer, score_state text, coverage_percent integer, restricted boolean, contact_count integer,
  total_count bigint
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
  scored as (
    select c.id, c.canonical_name, c.normalized_name, c.primary_domain, c.location, c.qualification_state, c.updated_at,
           cs.grade as stored_grade, cs.score as stored_score, cs.status as stored_status, cs.coverage_percent as stored_coverage,
           case
             when cs.id is null then
               case when exists (select 1 from public.lead_scores o, dp
                                  where o.company_id = c.id and o.icp_profile_id = dp.id and o.status in ('scored', 'excluded', 'stale'))
                    then 'outdated' else 'none' end
             when cs.input_fingerprint = (public.scoring_input(p_workspace_id, c.id, cs.icp_profile_id) ->> 'fingerprint')
               then case when cs.status = 'excluded' then 'excluded' else 'current' end
             else 'outdated'
           end as score_state,
           exists (select 1 from public.suppression_records r
                    where r.company_id = c.id and r.workspace_id = c.workspace_id and r.scope = 'company' and r.active) as restricted,
           (select count(*) from public.contacts k
             where k.company_id = c.id and k.workspace_id = c.workspace_id and k.archived_at is null)::integer as contact_count
      from public.companies c
      left join lateral (
        select s.id, s.icp_profile_id, s.grade, s.score, s.status, s.coverage_percent, s.input_fingerprint
          from public.lead_scores s, dp
         where s.company_id = c.id and s.workspace_id = c.workspace_id and s.icp_profile_id = dp.id
           and s.icp_revision = dp.revision and s.status in ('scored', 'excluded')
         limit 1
      ) cs on true
     where c.workspace_id = p_workspace_id and c.archived_at is null
  ),
  base as (
    select b.*,
           case when b.score_state = 'current' then b.stored_grade end as grade,
           case when b.score_state = 'current' then b.stored_score end as score,
           case when b.score_state in ('current', 'excluded') then b.stored_coverage end as coverage_percent
      from scored b
  )
  select b.id, b.canonical_name, b.primary_domain, b.location, b.qualification_state, b.updated_at,
         b.grade, b.score, b.score_state, b.coverage_percent, b.restricted, b.contact_count, count(*) over () as total_count
    from base b
   where (p_qualification is null or b.qualification_state = p_qualification)
     and (p_grade is null
          or (p_grade in ('A', 'B', 'C') and b.grade = p_grade)
          or (p_grade = 'excluded' and b.score_state = 'excluded')
          or (p_grade = 'outdated' and b.score_state = 'outdated')
          or (p_grade = 'none' and b.score_state = 'none'))
     and (p_restricted is null or b.restricted = p_restricted)
     and (p_has_contact is null or (b.contact_count > 0) = p_has_contact)
     and (p_country is null or b.location ->> 'countryCode' = p_country)
   order by
     case when p_sort = 'name' then b.normalized_name end asc,
     case when p_sort = 'qualification' then array_position(array['qualified', 'needs_review', 'unreviewed', 'unqualified'], b.qualification_state) end asc,
     case when p_sort = 'grade' then coalesce(array_position(array['A', 'B', 'C'], b.grade),
                                              case b.score_state when 'excluded' then 4 when 'outdated' then 5 else 6 end) end asc,
     case when p_sort = 'grade' then b.score end desc nulls last,
     case when p_sort not in ('name', 'qualification', 'grade') then b.updated_at end desc,
     b.normalized_name asc,
     b.id asc
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_companies(uuid, text, text, boolean, boolean, text, text, integer, integer) from public, anon;
grant execute on function public.list_companies(uuid, text, text, boolean, boolean, text, text, integer, integer) to authenticated, service_role;
