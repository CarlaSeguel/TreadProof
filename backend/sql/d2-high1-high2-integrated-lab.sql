-- TreadProof D2: HIGH1 + HIGH2 integrated laboratory.
-- ONLY: treadproof_d2_high_integrated, localhost:55440.
-- DO NOT APPLY TO D1, PRODUCTION OR ORIGINAL HIGH LABS.
BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'treadproof_d2_high_integrated'
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR inet_server_port() <> 55440
     OR current_setting('data_directory')
        <> '/home/carla/treadproof-d2-sql-lab/data'
     OR session_user <> 'tp_d2_lab_admin'
  THEN
    RAISE EXCEPTION 'HIGH_INTEGRATED_WRONG_TARGET';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION nfu_store.run(op text, j jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'on'
AS $function$
DECLARE grant_user uuid; grant_org uuid; i nfu_store.intents; a nfu_store.attempts; d jsonb; p jsonb; desired text; new_reason text;
BEGIN
 IF inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55440 OR current_database() <>'treadproof_d2_high_integrated'
   OR jsonb_typeof(j)<>'object' OR pg_column_size(j)>1048576 OR EXISTS(
    SELECT FROM jsonb_object_keys(j) k WHERE k<>ALL(ARRAY['id','idempotencyKey','binding','revisionHash','descriptor','payloadDigest','reviewDigest','hash','revision','sequenceKey','patch','result','grantToken']))
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_local_request'; END IF;
 IF op NOT IN ('create','read','find','list','approve','stage','cas')
    AND NOT (
      op='verified'
      AND session_user='tp_nfu_verifier_login'
    ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='verifier_role_required';
  END IF;
  IF op='verified' THEN
    IF session_user <> 'tp_nfu_verifier_login' THEN
      RAISE EXCEPTION USING
        ERRCODE='42501',
        MESSAGE='verifier_role_required';
    END IF;
  ELSE
  SELECT g.user_id, g.organization_id INTO grant_user, grant_org
    FROM d2_security.consume_grant(
      j->>'grantToken', op,
      pg_catalog.sha256(pg_catalog.convert_to(op || ':' || (j - 'grantToken')::text, 'UTF8'))
    ) AS g;
  IF grant_user IS NULL OR grant_org IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authorization_required';
  END IF;
  PERFORM pg_catalog.set_config('tp_nfu.user', grant_user::text, true);
  PERFORM pg_catalog.set_config('tp_nfu.org', grant_org::text, true);
  END IF;
 IF op='create' THEN
  d=j->'descriptor';
  IF jsonb_typeof(d)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(d) k WHERE k<>ALL(ARRAY['userId','organizationId','origin','role','actor','actors','action','networkPassphrase','contract','sequence','parameters','target','transactionXdr','expiresAt','beforeBatchXdr','revisionHash']))
   OR d->>'userId'<>current_setting('tp_nfu.user') OR d->>'organizationId'<>current_setting('tp_nfu.org')
   OR d->>'networkPassphrase'<>'Test SDF Network ; September 2015'
   OR d->>'action' NOT IN('create_batch','confirm_pickup','start_transit','confirm_reception','confirm_valorization')
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_intent'; END IF;
  -- Serializes identical idempotency keys; unique constraints also protect hash and ownership.
  PERFORM pg_advisory_xact_lock(hashtextextended(current_setting('tp_nfu.user')||current_setting('tp_nfu.org')||(j->>'idempotencyKey'),0));
  SELECT * INTO i FROM nfu_store.intents WHERE owner_user=current_setting('tp_nfu.user')::uuid AND owner_org=current_setting('tp_nfu.org')::uuid AND idempotency_key=(j->>'idempotencyKey')::uuid;
  IF FOUND THEN
   IF i.payload_digest<>j->>'payloadDigest' OR i.binding<>j->>'binding' OR i.review_digest<>j->>'reviewDigest' THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict'; END IF;
   RETURN to_jsonb(i);
  END IF;
  IF (d->>'expiresAt')::timestamptz<=clock_timestamp() OR (d->>'expiresAt')::timestamptz>clock_timestamp()+interval '125 seconds'
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='intent_expired'; END IF;
  INSERT INTO nfu_store.intents(id,owner_user,owner_org,idempotency_key,binding,descriptor,payload_digest,review_digest,tx_hash,expires_at)
   VALUES((j->>'id')::uuid,(d->>'userId')::uuid,(d->>'organizationId')::uuid,(j->>'idempotencyKey')::uuid,j->>'binding',d,j->>'payloadDigest',j->>'reviewDigest',j->>'hash',(d->>'expiresAt')::timestamptz) RETURNING * INTO i;
  RETURN to_jsonb(i);
 END IF;
 IF op='list' THEN RETURN coalesce((SELECT jsonb_agg(to_jsonb(pending_row)||jsonb_build_object('account_sequence',pending_row.account_sequence::text)) FROM nfu_store.attempts pending_row WHERE owner_user=grant_user AND owner_org=grant_org AND state IN('sending','pending','unknown')),'[]'::jsonb); END IF;
 -- Informational MVCC reads never acquire row locks or grant transaction authority.
 IF op IN('read','find') THEN
  SELECT * INTO i FROM nfu_store.intents WHERE owner_user=grant_user AND owner_org=grant_org AND (CASE WHEN op='read' THEN id=(j->>'id')::uuid ELSE tx_hash=j->>'hash' END);
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF i.binding IS DISTINCT FROM j->>'binding' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='identity_changed'; END IF;
  IF op='read' THEN RETURN to_jsonb(i); END IF;
  SELECT * INTO a FROM nfu_store.attempts WHERE intent_id=i.id;
  RETURN CASE WHEN a.intent_id IS NULL THEN NULL ELSE to_jsonb(a)||jsonb_build_object('account_sequence',a.account_sequence::text) END;
 END IF;
 SELECT * INTO i FROM nfu_store.intents WHERE owner_user=grant_user AND owner_org=grant_org AND (CASE WHEN op='approve' THEN id=(j->>'id')::uuid ELSE tx_hash=j->>'hash' END) FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF i.binding IS DISTINCT FROM j->>'binding' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='identity_changed'; END IF;
 IF op='approve' THEN
  IF i.revision IS DISTINCT FROM (j->>'revision')::bigint THEN RETURN NULL; END IF;
  IF i.phase<>'prepared' OR i.expires_at<=clock_timestamp() OR i.review_digest IS DISTINCT FROM j->>'reviewDigest' OR i.descriptor->>'revisionHash' IS DISTINCT FROM j->>'revisionHash' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='approval_rejected'; END IF;
  UPDATE nfu_store.intents SET phase='authorized',revision=revision+1,updated_at=clock_timestamp() WHERE id=i.id RETURNING * INTO i;RETURN to_jsonb(i);
 END IF;
 SELECT * INTO a FROM nfu_store.attempts WHERE intent_id=i.id FOR UPDATE;
 IF op='stage' THEN
  IF a.intent_id IS NOT NULL THEN
   IF a.sequence_key<>j->>'sequenceKey' THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='sequence_conflict'; END IF;
   RETURN to_jsonb(a)||jsonb_build_object('account_sequence',a.account_sequence::text);
  END IF;
  IF i.phase<>'authorized' OR i.revision IS DISTINCT FROM (j->>'revision')::bigint OR i.expires_at<=clock_timestamp() OR i.descriptor->>'revisionHash' IS DISTINCT FROM j->>'revisionHash' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='intent_not_authorized'; END IF;
  INSERT INTO nfu_store.attempts(intent_id,owner_user,owner_org,tx_hash,network,account,account_sequence,sequence_key,state)
   VALUES(i.id,i.owner_user,i.owner_org,i.tx_hash,'testnet',i.descriptor->>'actor',(i.descriptor->>'sequence')::numeric,j->>'sequenceKey','signed') RETURNING * INTO a;
  RETURN to_jsonb(a)||jsonb_build_object('account_sequence',a.account_sequence::text);
 END IF;
 IF a.intent_id IS NULL OR a.revision IS DISTINCT FROM (j->>'revision')::bigint THEN RETURN NULL; END IF;
 IF op NOT IN('cas','verified') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unsupported_operation'; END IF;
 p=j->'patch';desired=p->>'state';
 IF jsonb_typeof(p)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(p) k WHERE k<>ALL(ARRAY['state','attempted','updatedAt','reason','ledger']))
  OR jsonb_typeof(p->'attempted')<>'boolean' OR (p->>'attempted')::boolean IS DISTINCT FROM (desired<>'signed') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_patch'; END IF;
 IF desired IN('confirmed','failed') AND (op<>'verified' OR j->'result'->>'state'<>desired OR j->'result'->>'hash'<>i.tx_hash OR (j->'result'->>'ledger')::bigint<>(p->>'ledger')::bigint)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='verified_result_required'; END IF;
 IF desired NOT IN('confirmed','failed') AND (p->>'ledger' IS NOT NULL OR j?'result') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='unexpected_result'; END IF;
 IF a.state IN('confirmed','failed') THEN
  IF op='verified' AND a.state=desired AND a.ledger=(p->>'ledger')::bigint AND a.result_digest=j->'result'->>'digest' THEN
   RETURN to_jsonb(a)||jsonb_build_object('account_sequence',a.account_sequence::text);
  END IF;
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='terminal_result_immutable';
 END IF;
 IF a.state='signed' AND (i.phase<>'authorized' OR i.expires_at<=clock_timestamp() OR i.descriptor->>'revisionHash' IS DISTINCT FROM j->>'revisionHash') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='intent_expired'; END IF;
 new_reason=p->>'reason';
 UPDATE nfu_store.attempts SET state=desired,attempted=(p->>'attempted')::boolean,revision=revision+1,reason=new_reason,
  ledger=(p->>'ledger')::bigint,result_digest=CASE WHEN op='verified' THEN j->'result'->>'digest' ELSE NULL END,
  receipt=CASE WHEN desired='confirmed' THEN j->'result'->'receipt' ELSE NULL END,
  dispatch_committed_at=coalesce(dispatch_committed_at,clock_timestamp()),updated_at=clock_timestamp() WHERE intent_id=i.id RETURNING * INTO a;
 UPDATE nfu_store.intents SET phase=CASE WHEN desired IN('sending','pending') THEN 'dispatch_pending' ELSE desired END,revision=revision+1,updated_at=clock_timestamp() WHERE id=i.id;
 RETURN to_jsonb(a)||jsonb_build_object('account_sequence',a.account_sequence::text);
END $function$;

-- Terminal verification enters only through the restricted wrapper.
CREATE OR REPLACE FUNCTION nfu_store.record_verified(
  scope_user uuid,
  scope_org uuid,
  payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'on'
AS $verified$
BEGIN
  IF session_user <> 'tp_nfu_verifier_login' THEN
    RAISE EXCEPTION USING
      ERRCODE='42501',
      MESSAGE='verifier_identity_required';
  END IF;

  IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
     OR pg_column_size(payload) > 1048576
     OR payload->>'hash' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(payload->'patch') IS DISTINCT FROM 'object'
     OR jsonb_typeof(payload->'result') IS DISTINCT FROM 'object'
     OR payload->'patch'->>'state' NOT IN ('confirmed','failed')
     OR payload->'result'->>'state'
        IS DISTINCT FROM payload->'patch'->>'state'
     OR payload->'result'->>'hash'
        IS DISTINCT FROM payload->>'hash'
  THEN
    RAISE EXCEPTION USING
      ERRCODE='22023',
      MESSAGE='invalid_verified_payload';
  END IF;

  PERFORM pg_catalog.set_config(
    'tp_nfu.user', scope_user::text, true
  );
  PERFORM pg_catalog.set_config(
    'tp_nfu.org', scope_org::text, true
  );

  RETURN nfu_store.run('verified', payload);
END;
$verified$;

ALTER FUNCTION nfu_store.record_verified(uuid,uuid,jsonb)
OWNER TO tp_nfu_store_owner;

REVOKE ALL ON FUNCTION nfu_store.record_verified(uuid,uuid,jsonb)
FROM PUBLIC;

GRANT CONNECT ON DATABASE treadproof_d2_high_integrated
TO tp_nfu_verifier_login;

GRANT USAGE ON SCHEMA nfu_store
TO tp_nfu_verifier;

GRANT EXECUTE ON FUNCTION nfu_store.record_verified(uuid,uuid,jsonb)
TO tp_nfu_verifier;

COMMIT;
