-- The historical binding table exists in the deployed D1/D2 schema.
-- The base-only local schema can also apply D3 migrations in its absence.
do $$
begin
  if to_regclass('public.batch_actor_bindings') is not null then
    grant select (batch_id, company_address, carrier_address, plant_address)
      on public.batch_actor_bindings to service_role;
  end if;
end;
$$;
