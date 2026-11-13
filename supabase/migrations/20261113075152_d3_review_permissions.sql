-- D3 review permissions are independent of participant membership.
-- A trusted administrator provisions operators by Auth user ID.
create table public.d3_operators (
  user_id uuid primary key references auth.users(id)
);

create table public.d3_affiliation_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  organization_type public.organization_type generated always as ('plant'::public.organization_type) stored,
  wallet text not null check (wallet ~ '^G[A-Z2-7]{55}$'),
  reviewed_by uuid not null default auth.uid() references auth.users(id),
  reviewed_at timestamptz not null default clock_timestamp(),
  review_status text not null check (review_status in ('pending', 'approved', 'rejected')),
  notes_reference text not null check (length(btrim(notes_reference)) between 1 and 1000),
  synthetic_fixture boolean not null default true,
  foreign key (organization_id, organization_type) references public.organizations(id, organization_type)
);

create table public.d3_reviewer_grants (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references auth.users(id),
  batch_id uuid not null references public.tire_batches(id),
  granted_by uuid not null default auth.uid() references auth.users(id),
  granted_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null check (expires_at > granted_at and isfinite(expires_at)),
  revoked_at timestamptz check (revoked_at >= granted_at and isfinite(revoked_at)),
  check (reviewer_id <> granted_by)
);

-- An operator can revoke an expired grant before issuing a replacement.
create unique index d3_one_unrevoked_grant_per_batch
  on public.d3_reviewer_grants (reviewer_id, batch_id) where revoked_at is null;

alter table public.d3_operators enable row level security;
alter table public.d3_affiliation_reviews enable row level security;
alter table public.d3_reviewer_grants enable row level security;

revoke all on public.d3_operators, public.d3_affiliation_reviews, public.d3_reviewer_grants
  from public, anon, authenticated, service_role;
grant select on public.d3_operators, public.d3_affiliation_reviews, public.d3_reviewer_grants to authenticated;
grant insert (organization_id, wallet, review_status, notes_reference)
  on public.d3_affiliation_reviews to authenticated;
grant insert (reviewer_id, batch_id, expires_at) on public.d3_reviewer_grants to authenticated;
grant update (revoked_at) on public.d3_reviewer_grants to authenticated;

create policy d3_operator_self_read on public.d3_operators
  for select to authenticated using (user_id = (select auth.uid()));

create policy d3_operator_read_affiliation on public.d3_affiliation_reviews
  for select to authenticated using (exists (select 1 from public.d3_operators));

create policy d3_operator_record_affiliation on public.d3_affiliation_reviews
  for insert to authenticated with check (
    reviewed_by = (select auth.uid()) and exists (select 1 from public.d3_operators)
  );

create policy d3_reviewer_read_active_grant on public.d3_reviewer_grants
  for select to authenticated using (
    reviewer_id = (select auth.uid()) and revoked_at is null and expires_at > statement_timestamp()
    and not exists (select 1 from public.profiles where id = (select auth.uid()))
    and not exists (select 1 from public.d3_operators)
  );

create policy d3_operator_read_grants on public.d3_reviewer_grants
  for select to authenticated using (
    reviewer_id <> (select auth.uid()) and exists (select 1 from public.d3_operators)
  );

create policy d3_operator_issue_grant on public.d3_reviewer_grants
  for insert to authenticated with check (
    granted_by = (select auth.uid()) and revoked_at is null and expires_at > statement_timestamp()
    and exists (select 1 from public.d3_operators)
  );

create policy d3_operator_revoke_grant on public.d3_reviewer_grants
  for update to authenticated using (
    revoked_at is null and exists (select 1 from public.d3_operators)
  ) with check (
    revoked_at <= statement_timestamp() and exists (select 1 from public.d3_operators)
  );
