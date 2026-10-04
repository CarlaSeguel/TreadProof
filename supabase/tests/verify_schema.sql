select c.relname as table_name,c.relrowsecurity as rls_enabled,
 has_table_privilege('anon',c.oid,'SELECT') as anon_can_select,
 has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_can_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('organizations','profiles','tire_batches','batch_evidence','batch_events') order by c.relname;
select schemaname,tablename,policyname,roles,cmd from pg_policies where tablename in ('organizations','profiles','tire_batches','batch_evidence','batch_events') or policyname like 'treadproof_%' order by tablename,policyname;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='treadproof-evidence';
select version,name from supabase_migrations.schema_migrations order by version;
