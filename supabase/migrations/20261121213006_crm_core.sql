-- ParkPilot CRM: core schema, living alongside ecco in its own `crm` schema.
create schema if not exists crm;
revoke all on schema crm from public, anon;
grant usage on schema crm to authenticated, service_role;
alter default privileges in schema crm revoke execute on functions from public;

create type crm.lead_stage    as enum ('enquiry', 'appointment', 'park_tour', 'closed_sale');
create type crm.lead_outcome  as enum ('open', 'won', 'lost');
create type crm.lead_source   as enum ('website_form', 'social_media', 'advertising', 'email', 'parkpilot_ai',
                                       'phone', 'walk_in', 'referral', 'import', 'other');
create type crm.activity_type as enum ('note', 'call', 'email', 'sms', 'walk_in', 'ai_conversation',
                                       'marketing_reply', 'stage_change', 'outcome_change', 'assignment', 'tour');
create type crm.tour_status   as enum ('scheduled', 'completed', 'no_show', 'cancelled');

create function crm.normalize_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p is null or btrim(p) = '' then null
    else (
      with d as (select regexp_replace(btrim(p), '[^0-9+]', '', 'g') v)
      select case
        when v like '+%'  then '+' || replace(substr(v, 2), '+', '')
        when v like '00%' then '+' || substr(v, 3)
        when v like '0%'  then '+44' || substr(v, 2)
        else '+' || v
      end from d)
  end;
$$;

create table crm.parks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  timezone text not null default 'Europe/London',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name),
  unique (id, workspace_id)
);

create table crm.park_staff (
  park_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  takes_leads boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (park_id, user_id),
  foreign key (park_id, workspace_id) references crm.parks(id, workspace_id) on delete cascade
);
create index park_staff_ws_idx on crm.park_staff (workspace_id);
create index park_staff_user_idx on crm.park_staff (user_id);

create table crm.people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  first_name text,
  last_name text,
  email extensions.citext,
  email_normalized text generated always as (lower(btrim(email::text))) stored,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  postcode text,
  is_owner boolean not null default false,
  owner_since date,
  contact_id uuid references public.contacts(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(email::text, phone, first_name, last_name) is not null),
  unique (id, workspace_id)
);
create unique index people_ws_email_uq on crm.people (workspace_id, email_normalized) where email is not null;
create index people_ws_phone_idx on crm.people (workspace_id, phone) where phone is not null;
create index people_contact_idx on crm.people (contact_id);
create index people_created_by_idx on crm.people (created_by);

create table crm.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  park_id uuid not null,
  person_id uuid not null,
  stage crm.lead_stage not null default 'enquiry',
  outcome crm.lead_outcome not null default 'open',
  lost_reason text,
  source crm.lead_source not null default 'other',
  source_detail text,
  external_source text,
  external_id text,
  assigned_to uuid references auth.users(id) on delete set null,
  interest text,
  budget_min numeric(12,2),
  budget_max numeric(12,2),
  part_exchange boolean not null default false,
  guest_to_owner boolean not null default false,
  expected_close_on date,
  sale_value numeric(12,2),
  stage_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (park_id, workspace_id) references crm.parks(id, workspace_id) on delete restrict,
  foreign key (person_id, workspace_id) references crm.people(id, workspace_id) on delete cascade,
  unique (workspace_id, external_source, external_id),
  unique (id, workspace_id),
  check (budget_min is null or budget_max is null or budget_min <= budget_max),
  check (outcome <> 'won' or stage = 'closed_sale')
);
create index leads_board_idx on crm.leads (workspace_id, park_id, outcome, stage);
create index leads_assigned_idx on crm.leads (assigned_to, outcome);
create index leads_person_idx on crm.leads (person_id, workspace_id);
create index leads_park_fk_idx on crm.leads (park_id, workspace_id);
create index leads_created_by_idx on crm.leads (created_by);

create table crm.activities (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid,
  person_id uuid,
  type crm.activity_type not null,
  body text,
  metadata jsonb not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  foreign key (lead_id, workspace_id) references crm.leads(id, workspace_id) on delete cascade,
  foreign key (person_id, workspace_id) references crm.people(id, workspace_id) on delete cascade,
  check (lead_id is not null or person_id is not null)
);
create index activities_lead_idx on crm.activities (lead_id, workspace_id, occurred_at desc);
create index activities_person_idx on crm.activities (person_id, workspace_id, occurred_at desc);
create index activities_ws_idx on crm.activities (workspace_id);
create index activities_created_by_idx on crm.activities (created_by);

create table crm.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid,
  person_id uuid,
  title text not null check (length(btrim(title)) between 1 and 200),
  details text,
  due_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (lead_id, workspace_id) references crm.leads(id, workspace_id) on delete cascade,
  foreign key (person_id, workspace_id) references crm.people(id, workspace_id) on delete cascade
);
create index tasks_my_list_idx on crm.tasks (assigned_to, completed_at, due_at);
create index tasks_lead_idx on crm.tasks (lead_id, workspace_id);
create index tasks_person_idx on crm.tasks (person_id, workspace_id);
create index tasks_ws_idx on crm.tasks (workspace_id);
create index tasks_completed_by_idx on crm.tasks (completed_by);
create index tasks_created_by_idx on crm.tasks (created_by);

create table crm.tours (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  park_id uuid not null,
  lead_id uuid not null,
  advisor_id uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status crm.tour_status not null default 'scheduled',
  mailbox_id uuid references public.mailboxes(id) on delete set null,
  calendar_event_id text,
  reminder_sent_at timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (park_id, workspace_id) references crm.parks(id, workspace_id) on delete cascade,
  foreign key (lead_id, workspace_id) references crm.leads(id, workspace_id) on delete cascade
);
create index tours_park_time_idx on crm.tours (park_id, workspace_id, starts_at);
create index tours_advisor_time_idx on crm.tours (advisor_id, starts_at);
create index tours_lead_idx on crm.tours (lead_id, workspace_id);
create index tours_mailbox_idx on crm.tours (mailbox_id);
create index tours_ws_idx on crm.tours (workspace_id);
create index tours_created_by_idx on crm.tours (created_by);

create trigger parks_updated  before update on crm.parks  for each row execute function private.set_updated_at();
create trigger people_updated before update on crm.people for each row execute function private.set_updated_at();
create trigger leads_updated  before update on crm.leads  for each row execute function private.set_updated_at();
create trigger tasks_updated  before update on crm.tasks  for each row execute function private.set_updated_at();
create trigger tours_updated  before update on crm.tours  for each row execute function private.set_updated_at();

create function crm.people_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.phone := crm.normalize_phone(new.phone);
  if new.email is not null and (tg_op = 'INSERT' or new.email is distinct from old.email) then
    select c.id into new.contact_id from public.contacts c
    where c.workspace_id = new.workspace_id and c.email_normalized = lower(btrim(new.email::text))
    limit 1;
  elsif new.email is null then
    new.contact_id := null;
  end if;
  return new;
end; $$;
create trigger people_before_write before insert or update on crm.people
  for each row execute function crm.people_before_write();

create function crm.link_contact_to_person() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update crm.people p set contact_id = new.id
  where p.workspace_id = new.workspace_id
    and p.email_normalized = lower(btrim(new.email::text))
    and p.contact_id is distinct from new.id;
  return null;
end; $$;
create trigger contacts_link_crm_person after insert or update of email on public.contacts
  for each row execute function crm.link_contact_to_person();

create function crm.leads_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.outcome = 'won' then new.stage := 'closed_sale'; end if;
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then new.stage_changed_at := now(); end if;
  if tg_op = 'INSERT' or new.outcome is distinct from old.outcome then
    new.closed_at := case when new.outcome = 'open' then null else now() end;
  end if;
  return new;
end; $$;
create trigger leads_before_write before insert or update on crm.leads
  for each row execute function crm.leads_before_write();

create function crm.leads_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if new.stage is distinct from old.stage then
    insert into crm.activities (workspace_id, lead_id, person_id, type, metadata, created_by)
    values (new.workspace_id, new.id, new.person_id, 'stage_change',
            jsonb_build_object('from', old.stage, 'to', new.stage), uid);
  end if;
  if new.outcome is distinct from old.outcome then
    insert into crm.activities (workspace_id, lead_id, person_id, type, body, metadata, created_by)
    values (new.workspace_id, new.id, new.person_id, 'outcome_change', new.lost_reason,
            jsonb_build_object('from', old.outcome, 'to', new.outcome), uid);
    if new.outcome = 'won' then
      update crm.people set is_owner = true, owner_since = coalesce(owner_since, current_date)
      where id = new.person_id;
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into crm.activities (workspace_id, lead_id, person_id, type, metadata, created_by)
    values (new.workspace_id, new.id, new.person_id, 'assignment',
            jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to), uid);
  end if;
  return null;
end; $$;
create trigger leads_after_update after update on crm.leads
  for each row execute function crm.leads_after_update();

create function crm.tours_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'scheduled' then
    update crm.leads set stage = 'appointment'
    where id = new.lead_id and outcome = 'open' and stage < 'appointment';
  elsif new.status = 'completed' then
    update crm.leads set stage = 'park_tour'
    where id = new.lead_id and outcome = 'open' and stage < 'park_tour';
  end if;
  return null;
end; $$;
create trigger tours_after_write after insert or update of status on crm.tours
  for each row execute function crm.tours_after_write();

create function crm.pick_advisor(p_park uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.user_id
  from crm.park_staff s
  join public.members m on m.workspace_id = s.workspace_id and m.user_id = s.user_id
                       and m.role in ('owner', 'admin', 'editor')
  where s.park_id = p_park and s.takes_leads
  order by
    (select count(*) from crm.leads l where l.park_id = p_park and l.assigned_to = s.user_id and l.outcome = 'open'),
    (select max(l.created_at) from crm.leads l where l.park_id = p_park and l.assigned_to = s.user_id) nulls first,
    s.user_id
  limit 1;
$$;

create function crm.ingest_lead(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := (p ->> 'workspace_id')::uuid;
  pk uuid := (p ->> 'park_id')::uuid;
  v_email text := nullif(lower(btrim(p ->> 'email')), '');
  v_phone text := crm.normalize_phone(p ->> 'phone');
  v_source crm.lead_source := coalesce((p ->> 'source')::crm.lead_source, 'parkpilot_ai');
  v_ext_source text := coalesce(nullif(p ->> 'external_source', ''), v_source::text);
  v_ext_id text := nullif(p ->> 'external_id', '');
  v_person uuid;
  v_lead uuid;
  v_advisor uuid;
  v_new boolean := false;
begin
  if not exists (select 1 from crm.parks where id = pk and workspace_id = ws) then
    raise exception 'Unknown park for this workspace' using errcode = 'P0002';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'An email address or phone number is required' using errcode = '22023';
  end if;

  if v_ext_id is not null then
    select id into v_lead from crm.leads
    where workspace_id = ws and external_source = v_ext_source and external_id = v_ext_id;
    if found then return v_lead; end if;
  end if;

  if v_email is not null then
    select id into v_person from crm.people where workspace_id = ws and email_normalized = v_email;
  end if;
  if v_person is null and v_phone is not null then
    select id into v_person from crm.people where workspace_id = ws and phone = v_phone
    order by created_at limit 1;
  end if;

  if v_person is null then
    insert into crm.people (workspace_id, first_name, last_name, email, phone, postcode)
    values (ws, nullif(p ->> 'first_name', ''), nullif(p ->> 'last_name', ''), v_email, v_phone,
            nullif(p ->> 'postcode', ''))
    returning id into v_person;
  else
    update crm.people set
      first_name = coalesce(first_name, nullif(p ->> 'first_name', '')),
      last_name  = coalesce(last_name,  nullif(p ->> 'last_name', '')),
      email      = coalesce(email, v_email),
      phone      = coalesce(phone, v_phone),
      postcode   = coalesce(postcode, nullif(p ->> 'postcode', ''))
    where id = v_person;
  end if;

  select id into v_lead from crm.leads
  where workspace_id = ws and park_id = pk and person_id = v_person and outcome = 'open'
  order by created_at desc limit 1;

  if v_lead is null then
    v_advisor := crm.pick_advisor(pk);
    insert into crm.leads (workspace_id, park_id, person_id, source, source_detail, external_source,
                           external_id, assigned_to, interest, part_exchange, guest_to_owner)
    values (ws, pk, v_person, v_source, nullif(p ->> 'source_detail', ''), v_ext_source, v_ext_id, v_advisor,
            nullif(p ->> 'interest', ''), coalesce((p ->> 'part_exchange')::boolean, false),
            coalesce((p ->> 'guest_to_owner')::boolean, false))
    returning id into v_lead;
    v_new := true;
  else
    select assigned_to into v_advisor from crm.leads where id = v_lead;
  end if;

  insert into crm.activities (workspace_id, lead_id, person_id, type, body, metadata)
  values (ws, v_lead, v_person,
          case when v_source = 'parkpilot_ai' then 'ai_conversation'::crm.activity_type else 'note'::crm.activity_type end,
          nullif(p ->> 'summary', ''),
          jsonb_strip_nulls(jsonb_build_object(
            'channel', p ->> 'channel', 'transcript_url', p ->> 'transcript_url',
            'external_source', v_ext_source, 'external_id', v_ext_id, 'marketing_consent', p -> 'marketing_consent')));

  insert into crm.tasks (workspace_id, lead_id, person_id, title, due_at, assigned_to)
  values (ws, v_lead, v_person,
          case when v_new then 'Respond to new enquiry' else 'Follow up repeat enquiry' end,
          now() + interval '2 hours', v_advisor);

  return v_lead;
end; $$;

revoke all on function crm.ingest_lead(jsonb) from public, anon, authenticated;
revoke all on function crm.pick_advisor(uuid) from public, anon, authenticated;
revoke all on function crm.people_before_write() from public, anon, authenticated;
revoke all on function crm.link_contact_to_person() from public, anon, authenticated;
revoke all on function crm.leads_before_write() from public, anon, authenticated;
revoke all on function crm.leads_after_update() from public, anon, authenticated;
revoke all on function crm.tours_after_write() from public, anon, authenticated;
grant execute on function crm.ingest_lead(jsonb) to service_role;
grant execute on function crm.pick_advisor(uuid) to service_role;
grant execute on function crm.normalize_phone(text) to authenticated, service_role;

grant select, insert, update, delete on all tables in schema crm to authenticated;
grant all on all tables in schema crm to service_role;
grant usage, select on all sequences in schema crm to authenticated, service_role;

alter table crm.parks enable row level security;
alter table crm.park_staff enable row level security;
alter table crm.people enable row level security;
alter table crm.leads enable row level security;
alter table crm.activities enable row level security;
alter table crm.tasks enable row level security;
alter table crm.tours enable row level security;

create policy "parks: members read" on crm.parks for select to authenticated using (private.is_member(workspace_id));
create policy "parks: admins insert" on crm.parks for insert to authenticated with check (private.has_role(workspace_id, 'admin'));
create policy "parks: admins update" on crm.parks for update to authenticated using (private.has_role(workspace_id, 'admin')) with check (private.has_role(workspace_id, 'admin'));
create policy "parks: admins delete" on crm.parks for delete to authenticated using (private.has_role(workspace_id, 'admin'));

create policy "park_staff: members read" on crm.park_staff for select to authenticated using (private.is_member(workspace_id));
create policy "park_staff: admins insert" on crm.park_staff for insert to authenticated with check (private.has_role(workspace_id, 'admin'));
create policy "park_staff: admins update" on crm.park_staff for update to authenticated using (private.has_role(workspace_id, 'admin')) with check (private.has_role(workspace_id, 'admin'));
create policy "park_staff: admins delete" on crm.park_staff for delete to authenticated using (private.has_role(workspace_id, 'admin'));

do $$
declare t text;
begin
  foreach t in array array['people', 'leads', 'tasks', 'tours'] loop
    execute format('create policy %I on crm.%I for select to authenticated using (private.is_member(workspace_id))', t || ': members read', t);
    execute format('create policy %I on crm.%I for insert to authenticated with check (private.has_role(workspace_id, ''editor''))', t || ': editors insert', t);
    execute format('create policy %I on crm.%I for update to authenticated using (private.has_role(workspace_id, ''editor'')) with check (private.has_role(workspace_id, ''editor''))', t || ': editors update', t);
    execute format('create policy %I on crm.%I for delete to authenticated using (private.has_role(workspace_id, ''admin''))', t || ': admins delete', t);
  end loop;
end $$;

create policy "activities: members read" on crm.activities for select to authenticated using (private.is_member(workspace_id));
create policy "activities: editors insert" on crm.activities for insert to authenticated
  with check (private.has_role(workspace_id, 'editor') and created_by = (select auth.uid())
              and type not in ('stage_change', 'outcome_change', 'assignment'));
create policy "activities: own notes update" on crm.activities for update to authenticated
  using (created_by = (select auth.uid()) and type = 'note' and private.is_member(workspace_id))
  with check (created_by = (select auth.uid()) and type = 'note');
create policy "activities: admins delete" on crm.activities for delete to authenticated using (private.has_role(workspace_id, 'admin'));

comment on schema crm is 'ParkPilot CRM. Marketing consent lives in ecco (public.contacts, public.suppression_list); crm.people.contact_id links to it.';
comment on function crm.ingest_lead(jsonb) is 'Lead-created entry point for ParkPilot AI, web forms and imports. Service role only. Idempotent on (external_source, external_id).';
