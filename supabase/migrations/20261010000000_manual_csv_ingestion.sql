-- =============================================================================
-- Vleeds P1-E2 — Manual + CSV ingestion
--
-- workspaces ─< import_batches ─< import_rows
--                    │                 │
--                    └──────┬──────────┘
--                           ▼  (traceability)
--                      lead_sources.import_batch_id / import_row_id
--
-- A CSV upload is STAGED: parsed rows land in import_rows, are mapped,
-- normalized, validated and matched, the user decides create / merge / skip,
-- and only then does a commit write companies, contacts and evidence.
-- Product meaning: docs/product/vleeds-imports.md.
--
-- public.ingest_lead() writes one company (+ optional contact + evidence) as
-- ONE transaction. It is used by manual entry and by each CSV row commit. It
-- is SECURITY INVOKER: RLS and column grants of the caller apply unchanged.
--
-- Access: any workspace member may create, run and cancel imports (the
-- collaborative lead model of P1-E1). Nothing is deletable through the API.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- import_batches
-- -----------------------------------------------------------------------------
create table public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  filename       text not null check (char_length(filename) between 1 and 255),
  status         text not null default 'mapping'
                 check (status in ('mapping', 'review', 'processing', 'completed', 'cancelled')),
  headers        jsonb not null check (jsonb_typeof(headers) = 'array' and jsonb_array_length(headers) between 1 and 100
                                       and octet_length(headers::text) <= 16384),
  mapping        jsonb check (mapping is null or (jsonb_typeof(mapping) = 'object' and octet_length(mapping::text) <= 16384)),
  total_rows     integer not null default 0 check (total_rows between 0 and 5000),
  valid_rows     integer not null default 0 check (valid_rows >= 0),
  invalid_rows   integer not null default 0 check (invalid_rows >= 0),
  created_rows   integer not null default 0 check (created_rows >= 0),
  merged_rows    integer not null default 0 check (merged_rows >= 0),
  skipped_rows   integer not null default 0 check (skipped_rows >= 0),
  failed_rows    integer not null default 0 check (failed_rows >= 0),
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz,
  archived_at    timestamptz,
  constraint import_batches_workspace_id_id_key unique (workspace_id, id),
  constraint import_batches_completed_has_time check (status <> 'completed' or completed_at is not null)
);

comment on table public.import_batches is
  'One CSV import session. File bytes are never stored: rows are parsed in memory into import_rows.';

create index import_batches_workspace_created_idx on public.import_batches (workspace_id, created_at desc);
create index import_batches_workspace_status_idx on public.import_batches (workspace_id, status);

-- -----------------------------------------------------------------------------
-- import_rows
-- -----------------------------------------------------------------------------
create table public.import_rows (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  import_batch_id        uuid not null,
  row_number             integer not null check (row_number between 1 and 100000),
  raw_data               jsonb not null check (jsonb_typeof(raw_data) = 'array' and octet_length(raw_data::text) <= 16384),
  normalized_data        jsonb check (normalized_data is null or (jsonb_typeof(normalized_data) = 'object'
                                                                    and octet_length(normalized_data::text) <= 16384)),
  validation_errors      jsonb check (validation_errors is null or (jsonb_typeof(validation_errors) = 'array'
                                                                        and octet_length(validation_errors::text) <= 8192)),
  match_state            text not null default 'unprocessed'
                         check (match_state in ('unprocessed', 'new', 'possible_duplicate', 'matched', 'invalid')),
  match_reason           text check (match_reason is null or match_reason in ('external_id', 'domain', 'phone', 'name_location', 'email', 'name_company')),
  matched_company_id     uuid,
  matched_contact_id     uuid,
  matched_import_row_id  uuid,
  decision               text check (decision is null or decision in ('create', 'merge', 'skip')),
  commit_result          text check (commit_result is null or commit_result in ('created', 'merged', 'skipped', 'failed')),
  commit_notes           jsonb check (commit_notes is null or (jsonb_typeof(commit_notes) = 'array' and octet_length(commit_notes::text) <= 8192)),
  committed_company_id   uuid,
  committed_contact_id   uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint import_rows_workspace_id_id_key unique (workspace_id, id),
  constraint import_rows_batch_row_number_key unique (import_batch_id, row_number),
  constraint import_rows_batch_fk foreign key (workspace_id, import_batch_id)
    references public.import_batches (workspace_id, id) on delete cascade,
  constraint import_rows_matched_company_fk foreign key (workspace_id, matched_company_id)
    references public.companies (workspace_id, id) on delete set null (matched_company_id),
  constraint import_rows_matched_contact_fk foreign key (workspace_id, matched_contact_id)
    references public.contacts (workspace_id, id) on delete set null (matched_contact_id),
  constraint import_rows_matched_row_fk foreign key (workspace_id, matched_import_row_id)
    references public.import_rows (workspace_id, id) on delete set null (matched_import_row_id),
  constraint import_rows_committed_company_fk foreign key (workspace_id, committed_company_id)
    references public.companies (workspace_id, id) on delete set null (committed_company_id),
  constraint import_rows_committed_contact_fk foreign key (workspace_id, committed_contact_id)
    references public.contacts (workspace_id, id) on delete set null (committed_contact_id),
  -- An invalid row can only ever be skipped.
  constraint import_rows_invalid_not_imported check (match_state <> 'invalid' or decision is null or decision = 'skip'),
  -- A created/merged row always says which company it wrote.
  constraint import_rows_written_has_company check (commit_result not in ('created', 'merged') or committed_company_id is not null)
);

comment on table public.import_rows is
  'Staged CSV rows: raw cells, normalized values, validation, match and the user decision. Once commit_result is set '
  'the row is frozen, so a retried commit can never write it twice.';

create index import_rows_batch_match_idx on public.import_rows (import_batch_id, match_state);
create index import_rows_batch_pending_idx on public.import_rows (import_batch_id, row_number) where commit_result is null;

-- -----------------------------------------------------------------------------
-- Evidence traceability
-- -----------------------------------------------------------------------------
alter table public.lead_sources
  add column import_batch_id uuid,
  add column import_row_id uuid,
  add constraint lead_sources_import_batch_fk foreign key (workspace_id, import_batch_id)
    references public.import_batches (workspace_id, id) on delete set null (import_batch_id),
  add constraint lead_sources_import_row_fk foreign key (workspace_id, import_row_id)
    references public.import_rows (workspace_id, id) on delete set null (import_row_id),
  add constraint lead_sources_import_row_needs_batch check (import_row_id is null or import_batch_id is not null);

create index lead_sources_import_batch_idx on public.lead_sources (import_batch_id) where import_batch_id is not null;

grant insert (import_batch_id, import_row_id) on table public.lead_sources to authenticated;

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------
-- Terminal batches (completed, cancelled) never change again; a batch can only
-- reach 'completed' from 'processing'.
create or replace function private.guard_import_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Archiving (hiding) a finished import is the only change allowed.
  if old.status in ('completed', 'cancelled')
     and (to_jsonb(new) - 'archived_at' - 'updated_at') is distinct from (to_jsonb(old) - 'archived_at' - 'updated_at') then
    raise exception 'import batch % is %', old.id, old.status using errcode = '55000';
  end if;
  if new.status = 'completed' and old.status <> 'processing' then
    raise exception 'import batch can only complete from processing' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- A row with a commit result is frozen (idempotency); rows of a terminal batch
-- are frozen too.
create or replace function private.guard_import_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if old.commit_result is not null and new is distinct from old then
    raise exception 'import row % is already committed', old.id using errcode = '55000';
  end if;
  select b.status into v_status from public.import_batches b where b.id = old.import_batch_id;
  if v_status in ('completed', 'cancelled') then
    raise exception 'import batch is %', v_status using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_import_batch() from public, anon;
revoke all on function private.guard_import_row() from public, anon;

create trigger import_batches_guard before update on public.import_batches
  for each row execute function private.guard_import_batch();
create trigger import_rows_guard before update on public.import_rows
  for each row execute function private.guard_import_row();

create trigger import_batches_set_updated_at before update on public.import_batches
  for each row execute function private.set_updated_at();
create trigger import_rows_set_updated_at before update on public.import_rows
  for each row execute function private.set_updated_at();

create trigger import_batches_tenant_keys_immutable before update on public.import_batches
  for each row execute function private.prevent_tenant_key_change('workspace_id', 'created_by', 'filename', 'headers', 'total_rows');
create trigger import_rows_tenant_keys_immutable before update on public.import_rows
  for each row execute function private.prevent_tenant_key_change('workspace_id', 'import_batch_id', 'row_number', 'raw_data');
create trigger lead_sources_import_keys_immutable before update on public.lead_sources
  for each row execute function private.prevent_tenant_key_change('import_batch_id', 'import_row_id');

-- -----------------------------------------------------------------------------
-- ingest_lead: one company (+ contact + evidence) as one transaction
-- -----------------------------------------------------------------------------
-- p_company  {"id"?: uuid, "fields": {...}}   id present = update (merge) the
--            given columns only; absent = insert.
-- p_contact  null | {"id"?: uuid, "fields": {...}, "primary_if_none"?: bool}
-- p_evidence [{"subject": "company"|"contact", "field_key", "observed_value",
--              "source_kind"}]
-- p_import_row_id  when set: the row is locked; if it already has a commit
--            result nothing is written and its recorded outcome is returned.
--            The row's batch must be 'processing'.
-- Field names are the table's column names. Values were normalized and
-- validated by the application (src/lib/lead-core, src/lib/imports); every
-- column CHECK still applies.
create or replace function public.ingest_lead(
  p_workspace_id uuid,
  p_company jsonb,
  p_contact jsonb default null,
  p_evidence jsonb default '[]'::jsonb,
  p_import_row_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row            record;
  v_batch_status   text;
  v_batch_id       uuid;
  v_company_id     uuid;
  v_contact_id     uuid;
  v_company_action text;
  v_contact_action text;
  f                jsonb := coalesce(p_company -> 'fields', '{}'::jsonb);
  c                jsonb := coalesce(p_contact -> 'fields', '{}'::jsonb);
begin
  if p_import_row_id is not null then
    select r.id, r.import_batch_id, r.commit_result, r.committed_company_id, r.committed_contact_id
      into v_row
      from public.import_rows r
     where r.id = p_import_row_id and r.workspace_id = p_workspace_id
       for update;
    if not found then
      raise exception 'import row not found' using errcode = '42501';
    end if;
    if v_row.commit_result is not null then
      return jsonb_build_object('already_committed', true, 'commit_result', v_row.commit_result,
                                'company_id', v_row.committed_company_id, 'contact_id', v_row.committed_contact_id);
    end if;
    v_batch_id := v_row.import_batch_id;
    select b.status into v_batch_status from public.import_batches b where b.id = v_batch_id;
    if v_batch_status is distinct from 'processing' then
      raise exception 'import batch is not being committed' using errcode = '55000';
    end if;
  end if;

  -- company -------------------------------------------------------------------
  if p_company ? 'id' then
    update public.companies x set
      canonical_name           = case when f ? 'canonical_name' then f ->> 'canonical_name' else x.canonical_name end,
      normalized_name          = case when f ? 'normalized_name' then f ->> 'normalized_name' else x.normalized_name end,
      website_url              = case when f ? 'website_url' then f ->> 'website_url' else x.website_url end,
      primary_domain           = case when f ? 'primary_domain' then f ->> 'primary_domain' else x.primary_domain end,
      primary_phone            = case when f ? 'primary_phone' then f ->> 'primary_phone' else x.primary_phone end,
      primary_phone_normalized = case when f ? 'primary_phone_normalized' then f ->> 'primary_phone_normalized' else x.primary_phone_normalized end,
      location                 = case when f ? 'location' then f -> 'location' else x.location end,
      employee_count_min       = case when f ? 'employee_count_min' then (f ->> 'employee_count_min')::integer else x.employee_count_min end,
      employee_count_max       = case when f ? 'employee_count_max' then (f ->> 'employee_count_max')::integer else x.employee_count_max end,
      qualification_state      = case when f ? 'qualification_state' then f ->> 'qualification_state' else x.qualification_state end,
      notes                    = case when f ? 'notes' then f ->> 'notes' else x.notes end
    where x.id = (p_company ->> 'id')::uuid and x.workspace_id = p_workspace_id and x.archived_at is null
    returning x.id into v_company_id;
    if v_company_id is null then
      raise exception 'company not found' using errcode = '42501';
    end if;
    v_company_action := 'merged';
  else
    insert into public.companies (workspace_id, canonical_name, normalized_name, website_url, primary_domain,
                                  primary_phone, primary_phone_normalized, location, employee_count_min,
                                  employee_count_max, qualification_state, notes)
    values (p_workspace_id, f ->> 'canonical_name', f ->> 'normalized_name', f ->> 'website_url', f ->> 'primary_domain',
            f ->> 'primary_phone', f ->> 'primary_phone_normalized', f -> 'location',
            (f ->> 'employee_count_min')::integer, (f ->> 'employee_count_max')::integer,
            coalesce(f ->> 'qualification_state', 'unreviewed'), f ->> 'notes')
    returning id into v_company_id;
    v_company_action := 'created';
  end if;

  -- contact -------------------------------------------------------------------
  if p_contact is not null and jsonb_typeof(p_contact) = 'object' then
    if p_contact ? 'id' then
      update public.contacts x set
        first_name       = case when c ? 'first_name' then c ->> 'first_name' else x.first_name end,
        last_name        = case when c ? 'last_name' then c ->> 'last_name' else x.last_name end,
        full_name        = case when c ? 'full_name' then c ->> 'full_name' else x.full_name end,
        job_title        = case when c ? 'job_title' then c ->> 'job_title' else x.job_title end,
        seniority        = case when c ? 'seniority' then c ->> 'seniority' else x.seniority end,
        email            = case when c ? 'email' then c ->> 'email' else x.email end,
        normalized_email = case when c ? 'normalized_email' then c ->> 'normalized_email' else x.normalized_email end,
        phone            = case when c ? 'phone' then c ->> 'phone' else x.phone end,
        phone_normalized = case when c ? 'phone_normalized' then c ->> 'phone_normalized' else x.phone_normalized end,
        linkedin_url     = case when c ? 'linkedin_url' then c ->> 'linkedin_url' else x.linkedin_url end,
        notes            = case when c ? 'notes' then c ->> 'notes' else x.notes end
      where x.id = (p_contact ->> 'id')::uuid and x.workspace_id = p_workspace_id
        and x.company_id = v_company_id and x.archived_at is null
      returning x.id into v_contact_id;
      if v_contact_id is null then
        raise exception 'contact not found at this company' using errcode = '42501';
      end if;
      v_contact_action := 'merged';
    else
      insert into public.contacts (workspace_id, company_id, first_name, last_name, full_name, job_title, seniority,
                                   email, normalized_email, phone, phone_normalized, linkedin_url, notes, is_primary)
      values (p_workspace_id, v_company_id, c ->> 'first_name', c ->> 'last_name', c ->> 'full_name', c ->> 'job_title',
              c ->> 'seniority', c ->> 'email', c ->> 'normalized_email', c ->> 'phone', c ->> 'phone_normalized',
              c ->> 'linkedin_url', c ->> 'notes',
              case
                when coalesce((p_contact ->> 'is_primary')::boolean, false) then true
                when coalesce((p_contact ->> 'primary_if_none')::boolean, false) then not exists (
                  select 1 from public.contacts p
                   where p.company_id = v_company_id and p.is_primary and p.archived_at is null)
                else false
              end)
      returning id into v_contact_id;
      v_contact_action := 'created';
    end if;
  end if;

  -- evidence (append-only) ------------------------------------------------------
  insert into public.lead_sources (workspace_id, company_id, contact_id, source_kind, field_key, observed_value,
                                   import_batch_id, import_row_id)
  select p_workspace_id,
         v_company_id,
         case when e ->> 'subject' = 'contact' then v_contact_id end,
         e ->> 'source_kind',
         e ->> 'field_key',
         e -> 'observed_value',
         v_batch_id,
         p_import_row_id
    from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) e
   where e ->> 'subject' = 'company' or (e ->> 'subject' = 'contact' and v_contact_id is not null);

  if p_import_row_id is not null then
    update public.import_rows set
      commit_result        = v_company_action,
      committed_company_id = v_company_id,
      committed_contact_id = v_contact_id
    where id = p_import_row_id;
  end if;

  return jsonb_build_object('already_committed', false, 'commit_result', v_company_action,
                            'company_id', v_company_id, 'contact_id', v_contact_id,
                            'contact_result', v_contact_action);
end;
$$;

revoke all on function public.ingest_lead(uuid, jsonb, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.ingest_lead(uuid, jsonb, jsonb, jsonb, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- stage_import_rows: write the mapping/validation/match results of many staged
-- rows in one statement (5,000 single-row API calls would be far too slow).
-- Only uncommitted rows of the given batch in the given workspace are touched.
-- -----------------------------------------------------------------------------
create or replace function public.stage_import_rows(p_workspace_id uuid, p_batch_id uuid, p_rows jsonb)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with x as (
    select *
      from jsonb_to_recordset(p_rows) as x(
        id uuid, normalized_data jsonb, validation_errors jsonb, match_state text, match_reason text,
        matched_company_id uuid, matched_contact_id uuid, matched_import_row_id uuid, decision text)
  ),
  u as (
    update public.import_rows r set
      normalized_data       = x.normalized_data,
      validation_errors     = x.validation_errors,
      match_state           = x.match_state,
      match_reason          = x.match_reason,
      matched_company_id    = x.matched_company_id,
      matched_contact_id    = x.matched_contact_id,
      matched_import_row_id = x.matched_import_row_id,
      decision              = x.decision
    from x
    where r.id = x.id and r.workspace_id = p_workspace_id and r.import_batch_id = p_batch_id and r.commit_result is null
    returning 1
  )
  select count(*)::integer from u;
$$;

revoke all on function public.stage_import_rows(uuid, uuid, jsonb) from public, anon;
grant execute on function public.stage_import_rows(uuid, uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- list_companies: one page of the Leads list with filters, sorting and the
-- total count. Grade = a scored result for the workspace's active default ICP
-- profile at its CURRENT revision (never derived here, only read).
-- -----------------------------------------------------------------------------
create or replace function public.list_companies(
  p_workspace_id  uuid,
  p_qualification text default null,
  p_grade         text default null,     -- 'A' | 'B' | 'C' | 'none'
  p_restricted    boolean default null,
  p_has_contact   boolean default null,
  p_country       text default null,     -- ISO alpha-2
  p_sort          text default 'updated', -- 'updated' | 'name' | 'qualification' | 'grade'
  p_limit         integer default 25,
  p_offset        integer default 0
)
returns table (
  id uuid, canonical_name text, primary_domain text, location jsonb, qualification_state text,
  updated_at timestamptz, grade text, score integer, restricted boolean, contact_count integer, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select c.id, c.canonical_name, c.normalized_name, c.primary_domain, c.location, c.qualification_state, c.updated_at,
           cs.grade, cs.score,
           exists (select 1 from public.suppression_records r
                    where r.company_id = c.id and r.workspace_id = c.workspace_id and r.scope = 'company' and r.active) as restricted,
           (select count(*) from public.contacts k
             where k.company_id = c.id and k.workspace_id = c.workspace_id and k.archived_at is null)::integer as contact_count
      from public.companies c
      left join lateral (
        select s.grade, s.score
          from public.lead_scores s
          join public.icp_profiles p on p.id = s.icp_profile_id
         where s.company_id = c.id and s.workspace_id = c.workspace_id
           and p.is_default and p.archived_at is null
           and s.status = 'scored' and s.icp_revision = p.revision
         limit 1
      ) cs on true
     where c.workspace_id = p_workspace_id and c.archived_at is null
  )
  select b.id, b.canonical_name, b.primary_domain, b.location, b.qualification_state, b.updated_at,
         b.grade, b.score, b.restricted, b.contact_count, count(*) over () as total_count
    from base b
   where (p_qualification is null or b.qualification_state = p_qualification)
     and (p_grade is null or (p_grade = 'none' and b.grade is null) or b.grade = p_grade)
     and (p_restricted is null or b.restricted = p_restricted)
     and (p_has_contact is null or (b.contact_count > 0) = p_has_contact)
     and (p_country is null or b.location ->> 'countryCode' = p_country)
   order by
     case when p_sort = 'name' then b.normalized_name end asc,
     case when p_sort = 'qualification' then array_position(array['qualified', 'needs_review', 'unreviewed', 'unqualified'], b.qualification_state) end asc,
     case when p_sort = 'grade' then coalesce(array_position(array['A', 'B', 'C'], b.grade), 4) end asc,
     case when p_sort not in ('name', 'qualification', 'grade') then b.updated_at end desc,
     b.normalized_name asc,
     b.id asc
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_companies(uuid, text, text, boolean, boolean, text, text, integer, integer) from public, anon;
grant execute on function public.list_companies(uuid, text, text, boolean, boolean, text, text, integer, integer) to authenticated, service_role;
-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on table public.import_batches, public.import_rows from public, anon, authenticated;
grant select on table public.import_batches, public.import_rows to authenticated;

grant insert (workspace_id, filename, headers, total_rows) on table public.import_batches to authenticated;
grant update (status, mapping, valid_rows, invalid_rows, created_rows, merged_rows, skipped_rows, failed_rows,
              completed_at, archived_at)
  on table public.import_batches to authenticated;

grant insert (workspace_id, import_batch_id, row_number, raw_data) on table public.import_rows to authenticated;
grant update (normalized_data, validation_errors, match_state, match_reason, matched_company_id, matched_contact_id,
              matched_import_row_id, decision, commit_result, commit_notes, committed_company_id, committed_contact_id)
  on table public.import_rows to authenticated;

grant all on table public.import_batches, public.import_rows to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security: the same collaborative model as companies/contacts
-- -----------------------------------------------------------------------------
alter table public.import_batches enable row level security;
alter table public.import_rows    enable row level security;

create policy import_batches_select_member on public.import_batches for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy import_batches_insert_member on public.import_batches for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy import_batches_update_member on public.import_batches for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));

create policy import_rows_select_member on public.import_rows for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy import_rows_insert_member on public.import_rows for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy import_rows_update_member on public.import_rows for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
