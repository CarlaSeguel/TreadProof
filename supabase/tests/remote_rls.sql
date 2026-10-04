-- Run as postgres in Supabase SQL Editor. Every fixture is rolled back.
begin;
insert into auth.users(id) values
 ('f0000000-0000-4000-8000-000000000001'),('f0000000-0000-4000-8000-000000000002'),
 ('f0000000-0000-4000-8000-000000000003'),('f0000000-0000-4000-8000-000000000004');
insert into public.organizations(id,name,organization_type,stellar_address) values
 ('e0000000-0000-4000-8000-000000000001','RLS TEST company','company','G'||repeat('A',55)),
 ('e0000000-0000-4000-8000-000000000002','RLS TEST carrier','carrier','G'||repeat('B',55)),
 ('e0000000-0000-4000-8000-000000000003','RLS TEST plant','plant','G'||repeat('C',55)),
 ('e0000000-0000-4000-8000-000000000004','RLS TEST other','company','G'||repeat('D',55));
insert into public.profiles(id,organization_id,display_name)
select ('f0000000-0000-4000-8000-00000000000'||i)::uuid,('e0000000-0000-4000-8000-00000000000'||i)::uuid,'RLS test' from generate_series(1,4) i;
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
insert into public.tire_batches(id,tire_registry_address,onchain_batch_id,external_batch_code,company_organization_id,carrier_organization_id,plant_organization_id,created_by)
values('d0000000-0000-4000-8000-000000000001','C'||repeat('A',55),'18446744073709551615','RLS-TEST-ROLLBACK','e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000003',auth.uid());
do $$ begin
 if (select count(*) from public.tire_batches where external_batch_code='RLS-TEST-ROLLBACK')<>1 then raise exception 'Company visibility failed';end if;
 begin
  update public.profiles set organization_id='e0000000-0000-4000-8000-000000000004' where id=auth.uid();
  raise exception 'Self-assignment was allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.tire_batches set onchain_batch_id='1' where external_batch_code='RLS-TEST-ROLLBACK';
  raise exception 'Canonical link mutation was allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
do $$ begin if (select count(*) from public.tire_batches where external_batch_code='RLS-TEST-ROLLBACK')<>1 then raise exception 'Carrier visibility failed';end if;end $$;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000003',true);
do $$ begin if (select count(*) from public.tire_batches where external_batch_code='RLS-TEST-ROLLBACK')<>1 then raise exception 'Plant visibility failed';end if;end $$;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000004',true);
do $$ begin
 if exists(select 1 from public.tire_batches where external_batch_code='RLS-TEST-ROLLBACK') then raise exception 'Cross-organization leak';end if;
 if exists(select 1 from public.batch_events where batch_id='d0000000-0000-4000-8000-000000000001') then raise exception 'Event leak';end if;
end $$;
set local role anon;
do $$ begin
 begin perform * from public.tire_batches;raise exception 'Anonymous access allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: company/carrier/plant visibility, tenant separation, immutable links, protected memberships, anonymous denial; all fixtures rolled back' as result;
