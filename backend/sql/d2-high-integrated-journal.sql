-- PROPOSAL: additive LOCAL read API. No table data, roles, historical bindings or Supabase changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='8s';
DO $guard$ BEGIN
 IF current_user<>'tp_d2_lab_admin' OR current_database()<>'treadproof_d2_high_integrated'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() IS DISTINCT FROM 55440
 OR current_setting('server_version') NOT LIKE '17.11%'
 OR replace(current_setting('data_directory'),chr(92),'/')<>'/home/carla/treadproof-d2-sql-lab/data' THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='invalid_local_target';END IF;
 IF to_regprocedure('nfu_store.read_journal(text,jsonb)') IS NOT NULL THEN
 RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='reader_exists_review_required';END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='tp_nfu_store_owner' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin)
 OR NOT (SELECT bool_and(relrowsecurity AND relforcerowsecurity AND pg_get_userbyid(relowner)='tp_nfu_store_owner') FROM pg_class WHERE oid IN('nfu_store.intents'::regclass,'nfu_store.attempts'::regclass)) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='reader_owner_or_rls_invalid';END IF;
END $guard$;
LOCK TABLE nfu_store.intents,nfu_store.attempts IN SHARE MODE;
CREATE TEMP TABLE tp_journal_read_precheck ON COMMIT DROP AS SELECT
 md5(jsonb_build_array((SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]'::jsonb) FROM nfu_store.intents i),
 (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY intent_id),'[]'::jsonb) FROM nfu_store.attempts a))::text) AS rows_digest,
 md5(pg_get_functiondef('nfu_store.run(text,jsonb)'::regprocedure)) AS dispatcher_digest,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_class c WHERE oid IN('nfu_store.intents'::regclass,'nfu_store.attempts'::regclass)) AS table_catalog;
CREATE FUNCTION nfu_store.read_journal(kind text,j jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET row_security=on AS $$
DECLARE result jsonb;
BEGIN
 IF current_setting('transaction_read_only') IS DISTINCT FROM 'on'
 OR nullif(current_setting('tp_nfu.user',true),'') IS NULL OR nullif(current_setting('tp_nfu.org',true),'') IS NULL
 OR jsonb_typeof(j) IS DISTINCT FROM 'object' OR pg_column_size(j)>1024
 OR kind IS NULL OR kind NOT IN('intent','operation','recover') THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_journal_read';END IF;
 IF (kind='operation' AND (NOT j?'hash' OR (SELECT count(*) FROM jsonb_object_keys(j))<>1 OR coalesce(j->>'hash','')!~'^[a-f0-9]{64}$'))
 OR (kind IN('intent','recover') AND (NOT j?'id' OR (SELECT count(*) FROM jsonb_object_keys(j))<>1
  OR (kind='intent' AND j->>'id' IS NULL))) THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_journal_read';END IF;
 -- Explicit owner predicates and existing FORCE RLS; GUCs remain trusted-backend context, not SQL authentication.
 SELECT coalesce(jsonb_agg(row_data ORDER BY row_id),'[]'::jsonb) INTO result FROM (
  SELECT i.id AS row_id,jsonb_build_object(
   'id',i.id,'ownerUser',i.owner_user,'ownerOrganization',i.owner_org,'role',i.descriptor->>'role',
   'origin',i.descriptor->>'origin','hash',i.tx_hash,'action',i.descriptor->>'action',
   'actor',i.descriptor->>'actor','contract',i.descriptor->>'contract','networkPassphrase',i.descriptor->>'networkPassphrase',
   'batchId',i.descriptor->'target'->>'batch_id','localPhase',i.phase,'revision',i.revision,
   'createdAt',i.created_at,'updatedAt',i.updated_at,'expiresAt',i.expires_at,
   'attempt',CASE WHEN a.intent_id IS NULL THEN NULL ELSE jsonb_build_object(
     'state',a.state,'attempted',a.attempted,'ledger',a.ledger,'revision',a.revision,'updatedAt',a.updated_at) END
  ) AS row_data
  FROM nfu_store.intents i LEFT JOIN nfu_store.attempts a ON a.intent_id=i.id
   AND a.owner_user=i.owner_user AND a.owner_org=i.owner_org
  WHERE i.owner_user=current_setting('tp_nfu.user')::uuid AND i.owner_org=current_setting('tp_nfu.org')::uuid
   AND (CASE kind WHEN 'intent' THEN i.id=(j->>'id')::uuid WHEN 'operation' THEN i.tx_hash=j->>'hash'
    ELSE j->>'id' IS NULL OR i.id>(j->>'id')::uuid END)
  ORDER BY i.id LIMIT 26
 ) scoped_rows;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION nfu_store.read_journal(text,jsonb) FROM PUBLIC,tp_nfu_app;
ALTER FUNCTION nfu_store.read_journal(text,jsonb) OWNER TO tp_nfu_store_owner;
GRANT EXECUTE ON FUNCTION nfu_store.read_journal(text,jsonb) TO tp_nfu_app;
DO $postcheck$
DECLARE actual_digest text; actual_catalog jsonb; previous tp_journal_read_precheck;
BEGIN
 SELECT * INTO STRICT previous FROM tp_journal_read_precheck;
 SELECT md5(jsonb_build_array((SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]'::jsonb) FROM nfu_store.intents i),
  (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY intent_id),'[]'::jsonb) FROM nfu_store.attempts a))::text) INTO actual_digest;
 SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) INTO actual_catalog FROM pg_class c WHERE oid IN('nfu_store.intents'::regclass,'nfu_store.attempts'::regclass);
 IF actual_digest IS DISTINCT FROM previous.rows_digest OR actual_catalog IS DISTINCT FROM previous.table_catalog
 OR md5(pg_get_functiondef('nfu_store.run(text,jsonb)'::regprocedure)) IS DISTINCT FROM previous.dispatcher_digest
 OR NOT has_function_privilege('tp_nfu_app','nfu_store.read_journal(text,jsonb)','EXECUTE')
 OR EXISTS(SELECT FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid='nfu_store.read_journal(text,jsonb)'::regprocedure
   AND (a.grantee NOT IN(p.proowner,'tp_nfu_app'::regrole::oid) OR a.privilege_type<>'EXECUTE'
    OR (a.grantee='tp_nfu_app'::regrole::oid AND a.is_grantable))) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='reader_postcheck_failed';END IF;
END $postcheck$;
COMMIT;
