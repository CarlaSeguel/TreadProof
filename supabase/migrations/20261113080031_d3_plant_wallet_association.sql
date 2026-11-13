create table public.d3_association_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  organization_id uuid not null references public.organizations(id),
  approval_id uuid not null references public.d3_affiliation_reviews(id),
  wallet text not null check (wallet ~ '^G[A-Z2-7]{55}$'),
  nonce text not null unique check (nonce ~ '^[a-f0-9]{64}$'),
  message text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at = issued_at + interval '5 minutes'),
  signature_scheme text not null default 'SEP-53' check (signature_scheme = 'SEP-53'),
  signature text check (signature ~ '^[A-Za-z0-9+/]{86}==$'),
  consumed_at timestamptz,
  state text generated always as (case when consumed_at is null then 'pending' else 'consumed' end) stored,
  check ((signature is null) = (consumed_at is null)),
  check (consumed_at >= issued_at and consumed_at < expires_at)
);

alter table public.d3_association_challenges enable row level security;
revoke all on public.d3_association_challenges from public, anon, authenticated, service_role;
grant select on public.d3_affiliation_reviews to service_role;
grant select on public.d3_association_challenges to service_role;
grant insert (id,user_id,organization_id,approval_id,wallet,nonce,message,issued_at,expires_at)
  on public.d3_association_challenges to service_role;
grant update (signature,consumed_at) on public.d3_association_challenges to service_role;

-- The application verifies the signature before calling this server-only RPC.
-- PostgreSQL serializes contenders on the challenge row and rechecks eligibility.
create function public.d3_consume_association(
  challenge_id uuid, plant_user uuid, plant_org uuid, address text, signed_message text, proof_signature text
) returns table (verified_at timestamptz)
language sql security invoker set search_path = ''
as $$
  update public.d3_association_challenges c
     set signature = proof_signature, consumed_at = clock_timestamp()
   where c.id = challenge_id and c.user_id = plant_user and c.organization_id = plant_org
     and c.wallet = address and c.message = signed_message and c.consumed_at is null
     and clock_timestamp() >= c.issued_at and clock_timestamp() < c.expires_at
     and exists (
       select 1 from public.profiles p join public.organizations o on o.id = p.organization_id
       where p.id = c.user_id and o.id = c.organization_id and o.organization_type = 'plant'
     )
     and exists (
       select 1 from (
         select r.id, r.wallet, r.review_status from public.d3_affiliation_reviews r
          where r.organization_id = c.organization_id
          order by r.reviewed_at desc, r.id desc limit 1
       ) latest where latest.id = c.approval_id and latest.wallet = c.wallet and latest.review_status = 'approved'
     )
  returning c.consumed_at;
$$;

revoke all on function public.d3_consume_association(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.d3_consume_association(uuid,uuid,uuid,text,text,text) to service_role;
