-- TreadProof Phase 6. Operational metadata only; Stellar remains canonical.
create schema if not exists treadproof_private;
revoke all on schema treadproof_private from public, anon, authenticated;

create type public.organization_type as enum ('company', 'carrier', 'plant');
create table public.organizations (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(btrim(name)) between 1 and 160),
 organization_type public.organization_type not null,
 stellar_address text not null unique check (stellar_address ~ '^[GC][A-Z2-7]{55}$'),
 created_at timestamptz not null default now(),
 unique(id, organization_type)
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 organization_id uuid not null references public.organizations(id),
 display_name text not null check (length(btrim(display_name)) between 1 and 160),
 created_at timestamptz not null default now()
);
create index profiles_organization_idx on public.profiles(organization_id);

create table public.tire_batches (
 id uuid primary key default gen_random_uuid(),
 network text not null default 'testnet' check (network = 'testnet'),
 tire_registry_address text not null check (tire_registry_address ~ '^C[A-Z2-7]{55}$'),
 onchain_batch_id text not null check (onchain_batch_id ~ '^[1-9][0-9]{0,19}$' and onchain_batch_id::numeric <= 18446744073709551615),
 external_batch_code text not null unique check (external_batch_code ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'),
 company_organization_id uuid not null,
 carrier_organization_id uuid not null,
 plant_organization_id uuid not null,
 company_role public.organization_type generated always as ('company'::public.organization_type) stored,
 carrier_role public.organization_type generated always as ('carrier'::public.organization_type) stored,
 plant_role public.organization_type generated always as ('plant'::public.organization_type) stored,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(company_organization_id, company_role) references public.organizations(id, organization_type),
 foreign key(carrier_organization_id, carrier_role) references public.organizations(id, organization_type),
 foreign key(plant_organization_id, plant_role) references public.organizations(id, organization_type),
 unique(network, tire_registry_address, onchain_batch_id)
);
create index tire_batches_company_idx on public.tire_batches(company_organization_id);
create index tire_batches_carrier_idx on public.tire_batches(carrier_organization_id);
create index tire_batches_plant_idx on public.tire_batches(plant_organization_id);
create index tire_batches_creator_idx on public.tire_batches(created_by);

create table public.batch_evidence (
 id uuid primary key,
 batch_id uuid not null references public.tire_batches(id),
 evidence_type text not null check (evidence_type in ('pickup','reception','valorization','other')),
 storage_path text not null unique,
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 file_name text not null check (length(file_name) between 1 and 160 and file_name !~ '[/\\]'),
 content_type text not null check (content_type in ('application/pdf','image/png','image/jpeg','text/plain')),
 byte_size integer not null check (byte_size between 1 and 5242880),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 check (storage_path = batch_id::text || '/' || id::text || '/' || sha256)
);
create index batch_evidence_batch_idx on public.batch_evidence(batch_id);
create index batch_evidence_creator_idx on public.batch_evidence(created_by);

create table public.batch_events (
 id uuid primary key default gen_random_uuid(),
 batch_id uuid not null references public.tire_batches(id),
 actor_id uuid references auth.users(id),
 event_type text not null check (event_type in ('metadata_created','evidence_registered')),
 evidence_id uuid references public.batch_evidence(id),
 created_at timestamptz not null default now()
);
create index batch_events_batch_idx on public.batch_events(batch_id, created_at);
create index batch_events_actor_idx on public.batch_events(actor_id);
create index batch_events_evidence_idx on public.batch_events(evidence_id);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.tire_batches enable row level security;
alter table public.batch_evidence enable row level security;
alter table public.batch_events enable row level security;
revoke all on public.organizations,public.profiles,public.tire_batches,public.batch_evidence,public.batch_events from anon, authenticated;
grant select on public.organizations,public.profiles,public.tire_batches,public.batch_evidence,public.batch_events to authenticated;
grant insert on public.tire_batches,public.batch_evidence to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant all on public.organizations,public.profiles,public.tire_batches,public.batch_evidence,public.batch_events to service_role;

create policy profile_self_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profile_self_name on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Deliberate minimal directory for enrolled users, never anonymous/public data.
create policy enrolled_directory on public.organizations for select to authenticated using (exists(select 1 from public.profiles p where p.id = (select auth.uid())));
create policy batch_participants_read on public.tire_batches for select to authenticated using (
 exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.organization_id in (company_organization_id,carrier_organization_id,plant_organization_id))
);
create policy company_creates_metadata on public.tire_batches for insert to authenticated with check (
 created_by = (select auth.uid()) and exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.organization_id = company_organization_id)
);
create policy evidence_participants_read on public.batch_evidence for select to authenticated using (exists(select 1 from public.tire_batches b where b.id = batch_id));
create policy evidence_participants_insert on public.batch_evidence for insert to authenticated with check (
 created_by = (select auth.uid()) and exists(select 1 from public.tire_batches b where b.id = batch_id)
);
create policy events_participants_read on public.batch_events for select to authenticated using (exists(select 1 from public.tire_batches b where b.id = batch_id));

-- Trigger-only definer; no exposed RPC, fixed search_path, no dynamic SQL.
create function treadproof_private.log_metadata_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is not null and auth.uid() <> new.created_by then
   raise exception 'Actor mismatch' using errcode = '42501';
 end if;
 if tg_table_name = 'tire_batches' then
   insert into public.batch_events(batch_id,actor_id,event_type) values(new.id,new.created_by,'metadata_created');
 else
   insert into public.batch_events(batch_id,actor_id,event_type,evidence_id) values(new.batch_id,new.created_by,'evidence_registered',new.id);
 end if;
 return new;
end;
$$;
revoke all on function treadproof_private.log_metadata_event() from public,anon,authenticated;
create trigger log_batch_metadata after insert on public.tire_batches for each row execute function treadproof_private.log_metadata_event();
create trigger log_batch_evidence after insert on public.batch_evidence for each row execute function treadproof_private.log_metadata_event();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('treadproof-evidence','treadproof-evidence',false,5242880,array['application/pdf','image/png','image/jpeg','text/plain']);
create policy treadproof_evidence_read on storage.objects for select to authenticated using (
 bucket_id = 'treadproof-evidence' and exists(select 1 from public.batch_evidence e where e.storage_path = name)
);
create policy treadproof_evidence_insert on storage.objects for insert to authenticated with check (
 bucket_id = 'treadproof-evidence' and exists(select 1 from public.batch_evidence e where e.storage_path = name and e.created_by = (select auth.uid()))
);
-- No update/delete policy: evidence objects and metadata are immutable to clients.
comment on table public.tire_batches is 'Unverified off-chain linkage; API must reconcile IDs and actors with Stellar on every verified read.';
comment on table public.batch_evidence is 'Declared file hash; backend checks downloaded bytes and separately compares with the on-chain hash.';
comment on table public.organizations is 'Approved directory visible to enrolled users only. Roles and Stellar address assigned by trusted operator, never self-service.';
