. "$PSScriptRoot/common.ps1"
$d = Get-Content $script:Manifest -Raw | ConvertFrom-Json
Assert-Equal $d.network 'testnet' 'Manifiesto Testnet'
Assert-Links $d
$evidenceFile = Join-Path $script:Evidence 'TP-DEMO-0001.txt'
if (-not (Test-Path $evidenceFile)) {
    'TP-DEMO-0001 | STELLAR TESTNET ONLY | Synthetic NFU demo; no physical treatment, official certification or carbon credits. Declared 5000000 g; pickup 4980000 g; received 4950000 g; valorized 4900000 g.' | Set-Content -LiteralPath $evidenceFile -Encoding utf8
}
$hash = (Get-FileHash -LiteralPath $evidenceFile -Algorithm SHA256).Hash.ToLower()
$id = Invoke-Contract 'demo-01-create' $d.tire_registry $d.aliases.company @('create_batch','--company',$d.company,'--carrier',$d.carrier,'--plant',$d.plant,'--declared_mass','5000000') -Resume | ConvertFrom-Json
Invoke-Contract 'demo-02-pickup' $d.tire_registry $d.aliases.carrier @('confirm_pickup','--id',"$id",'--pickup_mass','4980000') -Resume | Out-Null
Invoke-Contract 'demo-03-transit' $d.tire_registry $d.aliases.carrier @('start_transit','--id',"$id") -Resume | Out-Null
Invoke-Contract 'demo-04-reception' $d.tire_registry $d.aliases.plant @('confirm_reception','--id',"$id",'--received_mass','4950000') -Resume | Out-Null
Invoke-Contract 'demo-05-valorization' $d.tire_registry $d.aliases.plant @('confirm_valorization','--id',"$id",'--valorized_mass','4900000','--evidence_hash',$hash) -Resume | Out-Null
Invoke-Contract 'demo-06-credit' $d.impact_registry $d.aliases.company @('credit_batch','--batch_id',"$id") -Resume | Out-Null
Invoke-Contract 'demo-07-unlock' $d.badge_contract $d.aliases.company @('check_and_unlock','--company',$d.company) -Resume | Out-Null
[ordered]@{label='TP-DEMO-0001'; batch_id=$id; evidence_sha256=$hash; synthetic=$true} | ConvertTo-Json | Set-Content deployments/demo-testnet.json -Encoding utf8
& "$PSScriptRoot/verify.ps1"
Invoke-Contract 'negative-duplicate-credit' $d.impact_registry $d.aliases.company @('credit_batch','--batch_id',"$id") -Query -ExpectedError 'Error\(Contract, #2\)|AlreadyCredited' | Out-Null
Invoke-Contract 'negative-duplicate-valorization' $d.tire_registry $d.aliases.plant @('confirm_valorization','--id',"$id",'--valorized_mass','4900000','--evidence_hash',$hash) -Query -ExpectedError 'Error\(Contract, #3\)|InvalidState' | Out-Null
$again = Invoke-Contract 'negative-repeat-unlock' $d.badge_contract $d.aliases.company @('check_and_unlock','--company',$d.company) -Resume
Assert-Equal $again '[]' 'Repeticion sin nuevas credenciales'
& "$PSScriptRoot/verify.ps1"
Write-Host 'DEMO y pruebas negativas completados.'
