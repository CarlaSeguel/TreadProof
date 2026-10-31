// Trusted server configuration only. Never constructed from an HTTP request.
import path from 'node:path';
import fs from 'node:fs';
import {requireThat} from './validation.js';
const approved=new WeakSet();
const fail=()=>{throw Object.assign(Error('invalid_postgres_runtime'),{code:'invalid_postgres_runtime'});};
const clean=(env,linux=false)=>({...Object.fromEntries(Object.entries(env).filter(([k])=>!/^PG|^PSQL/i.test(k)&&(!linux||!/^LD_/i.test(k)))),PGCLIENTENCODING:'UTF8'});
const absolute=v=>typeof v==='string'&&/^\/[A-Za-z0-9_./-]+$/.test(v)&&path.posix.normalize(v)===v;
const quote=v=>"'"+v.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'";

export function createPostgresRuntime({config,platform=process.platform,env=process.env,fileSystem=fs,uid=()=>process.getuid()}={}){
 let runtime;
 if(config===undefined){
  if(platform!=='win32')fail(); // No SSPI/path fallback on Linux.
  const root=path.win32.join(env.LOCALAPPDATA??'C:/Users/k_bxo/AppData/Local','TreadProof/nfu-postgres-d1-store');
  runtime={mode:'postgres_local_sspi',database:'treadproof_nfu',
   executable:path.win32.join(path.win32.dirname(root),'postgres17/pgsql/bin/psql.exe'),
   accepts:db=>['treadproof_nfu','treadproof_nfu_tests'].includes(db),
   connection:db=>`host=127.0.0.1 port=55439 dbname=${db} user=tp_nfu_app connect_timeout=5 require_auth=sspi sslmode=disable gssencmode=disable passfile=NUL`,
   environment:()=>clean(env)};
 }else{
  if(platform!=='linux'||!config||Object.getPrototypeOf(config)!==Object.prototype)fail();
  const keys=['psqlPath','host','port','database','sslRootCert','passfile'];
  if(Object.keys(config).length!==keys.length||Object.keys(config).some(k=>!keys.includes(k)))fail();
  const c=Object.freeze({...config});
  if(!absolute(c.psqlPath)||!absolute(c.sslRootCert)||!absolute(c.passfile)||new Set([c.psqlPath,c.sslRootCert,c.passfile]).size!==3||
   typeof c.host!=='string'||c.host.length>253||!c.host.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))||
   c.port!==55439||!['treadproof_nfu','treadproof_nfu_tests'].includes(c.database))fail();
  function files(){
   // Inspect metadata only; libpq reads the password. Never load its contents into JS.
   try{
    const secret=fileSystem.lstatSync(c.passfile);
    if(!secret.isFile()||secret.isSymbolicLink()||secret.nlink!==1||secret.uid!==uid()||![0o400,0o600].includes(secret.mode&0o7777)||fileSystem.realpathSync(c.passfile)!==c.passfile)fail();
    for(const p of [c.psqlPath,c.sslRootCert]){const s=fileSystem.statSync(p);if(!s.isFile()||(s.mode&0o022)!==0)fail();}
   }catch{fail();}
  }
  files();
  runtime={mode:'postgres_libpq_tls',database:c.database,executable:c.psqlPath,accepts:db=>db===c.database,
   // Existing SQL also pins server IPv4 loopback, port and database names.
   // Keep that guard intact: the first Linux profile is co-located PostgreSQL.
   connection:db=>{files();return `host=${quote(c.host)} hostaddr=127.0.0.1 port=${c.port} dbname=${quote(db)} user=tp_nfu_app connect_timeout=5 require_auth=scram-sha-256 sslmode=verify-full channel_binding=require gssencmode=disable sslrootcert=${quote(c.sslRootCert)} passfile=${quote(c.passfile)}`;},
   environment:()=>clean(env,true)};
 }
 Object.freeze(runtime);approved.add(runtime);return runtime;
}

export function postgresTarget({runtime=createPostgresRuntime(),database=runtime.database,timeoutMs=12000}={}){
 requireThat(approved.has(runtime)&&runtime.accepts(database)&&Number.isInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=15000,503,'invalid_local_database_target');
 return Object.freeze({database,mode:runtime.mode,executable:runtime.executable,environment:runtime.environment,
  connection:application=>{requireThat(/^treadproof_[a-z_]+$/.test(application),503,'invalid_postgres_runtime');return runtime.connection(database)+' application_name='+application;}});
}
