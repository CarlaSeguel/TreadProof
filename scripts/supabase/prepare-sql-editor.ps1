param([string]$Migration = 'supabase/migrations/20261002182133_offchain_mvp.sql')
$ErrorActionPreference='Stop'
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
$resolved = (Resolve-Path -LiteralPath $Migration).Path
$allowedRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location) 'supabase/migrations')) + [IO.Path]::DirectorySeparatorChar
if (-not $resolved.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'La migracion debe estar dentro de supabase/migrations.' }
$file = [IO.Path]::GetFileNameWithoutExtension($resolved)
if ($file -notmatch '^(\d{14})_([a-z0-9_]+)$') { throw 'Nombre de migracion invalido' }
$version=$Matches[1]; $name=$Matches[2]
$sql=Get-Content -LiteralPath $resolved -Raw
$escaped=$sql.Replace("'","''")
$wrapper=@"
begin;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
alter table supabase_migrations.schema_migrations enable row level security;
revoke all on schema supabase_migrations from public,anon,authenticated;
revoke all on supabase_migrations.schema_migrations from public,anon,authenticated;
-- Duplicate versions fail atomically; never replay an applied migration.
insert into supabase_migrations.schema_migrations(version,name,statements) values('$version','$name',array['$escaped']);
$sql
commit;
select version,name from supabase_migrations.schema_migrations where version='$version';
"@
New-Item -ItemType Directory -Force .tools | Out-Null
$output=Join-Path (Get-Location) ".tools/$file.sql"
[IO.File]::WriteAllText($output,$wrapper,[Text.UTF8Encoding]::new($false))
Write-Output "SQL atomico para el editor: $output"
