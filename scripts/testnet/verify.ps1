. "$PSScriptRoot/common.ps1"
$d = Get-Content $script:Manifest -Raw | ConvertFrom-Json
$demo = Get-Content deployments/demo-testnet.json -Raw | ConvertFrom-Json
Assert-Equal $d.network 'testnet' 'Manifiesto Testnet'
Assert-Links $d
$batch = Invoke-Contract 'verify-batch' $d.tire_registry $d.aliases.company @('get_batch','--id',"$($demo.batch_id)") -Query | ConvertFrom-Json
Assert-Equal $batch.company $d.company 'Empresa del lote'
Assert-Equal $batch.carrier $d.carrier 'Transportista'
Assert-Equal $batch.plant $d.plant 'Planta'
Assert-Equal $batch.status 'Valorized' 'Estado final'
Assert-Equal $batch.declared_mass 5000000 'Masa declarada'
Assert-Equal $batch.pickup_mass 4980000 'Masa retirada'
Assert-Equal $batch.received_mass 4950000 'Masa recibida'
Assert-Equal $batch.valorized_mass 4900000 'Masa valorizada'
Assert-Equal $batch.evidence_hash $demo.evidence_sha256 'Hash de evidencia DEMO'
$impact = Invoke-Contract 'verify-impact' $d.impact_registry $d.aliases.company @('get_company_impact','--company',$d.company) -Query | ConvertFrom-Json
Assert-Equal $impact.company $d.company 'Empresa beneficiaria'
Assert-Equal $impact.total_verified_grams 4900000 'Gramos acreditados'
Assert-Equal $impact.credited_batch_count 1 'Contador en acumulado'
$count = Invoke-Contract 'verify-count' $d.impact_registry $d.aliases.company @('get_credited_batch_count','--company',$d.company) -Query | ConvertFrom-Json
Assert-Equal $count 1 'Un solo lote acreditado'
$credited = Invoke-Contract 'verify-credited' $d.impact_registry $d.aliases.company @('is_batch_credited','--batch_id',"$($demo.batch_id)") -Query | ConvertFrom-Json
Assert-Equal $credited $true 'Lote acreditado'
$points = Invoke-Contract 'verify-tirepoints' $d.impact_registry $d.aliases.company @('get_tirepoints','--company',$d.company) -Query | ConvertFrom-Json
Assert-Equal $points.whole 4900 'TirePoints completos'
Assert-Equal $points.remainder_grams 0 'Gramos fraccionarios'
foreach ($level in @('Trace','Recover','Circular','Impact','Champion')) {
    $has = Invoke-Contract "verify-badge-$level" $d.badge_contract $d.aliases.company @('has_badge','--company',$d.company,'--badge_level',('"' + $level + '"')) -Query | ConvertFrom-Json
    Assert-Equal $has ($level -eq 'Trace') "Credencial $level"
}
$highest = Invoke-Contract 'verify-highest' $d.badge_contract $d.aliases.company @('get_highest_badge','--company',$d.company) -Query | ConvertFrom-Json
Assert-Equal $highest 'Trace' 'Mayor nivel'
$record = Invoke-Contract 'verify-record' $d.badge_contract $d.aliases.company @('get_badge_record','--company',$d.company,'--badge_level','"Trace"') -Query | ConvertFrom-Json
Assert-Equal $record.company $d.company 'Titular credencial'
Assert-Equal $record.level 'Trace' 'Nivel registrado'
Assert-Equal $record.verified_grams 4900000 'Evidencia del desbloqueo'
Assert-Equal $record.impact_registry $d.impact_registry 'Origen de la credencial'
Assert-Equal $record.threshold_grams 1000000 'Umbral TRACE'
Assert-Equal $record.credited_batch_count 1 'Lotes al desbloquear'
Assert-Equal $record.rules_version 1 'Version de reglas'
if ($record.unlocked_at -le 0 -or $record.unlocked_ledger -le 0) { throw 'Falta fecha/ledger de desbloqueo.' }
$records = Invoke-Contract 'verify-all-badges' $d.badge_contract $d.aliases.company @('get_company_badges','--company',$d.company) -Query | ConvertFrom-Json
Assert-Equal @($records).Count 1 'Una unica credencial'
$original = (Get-Content (Join-Path $script:Evidence 'demo-07-unlock.json') -Raw | ConvertFrom-Json).stdout | ConvertFrom-Json
Assert-Equal ($record | ConvertTo-Json -Compress) (@($original)[0] | ConvertTo-Json -Compress) 'Registro original conservado'
Write-Host 'Flujo verificado: VALORIZED, 4900 TP, TRACE y ninguna otra insignia.'
