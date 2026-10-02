. "$PSScriptRoot/common.ps1"
if (Test-Path $script:Manifest) { throw 'Ya existe deployments/testnet.json. Usar verify.ps1; no se sobrescribe el despliegue.' }
& "$PSScriptRoot/quality.ps1"
$net = Invoke-PublicStep 'network' @('network','info','--network','testnet','--output','json') | ConvertFrom-Json
Assert-Equal $net.passphrase 'Test SDF Network ; September 2015' 'Red Testnet'
$aliases = [ordered]@{company='tp-demo-company';carrier='tp-demo-carrier';plant='tp-demo-plant'}
$keys = @{}
foreach ($role in $aliases.Keys) {
    $alias = $aliases[$role]
    # Generation output stays ignored; do not publish seeds or key files.
    & $script:Cli --config-dir $script:Config keys address $alias *> (Join-Path $script:Config 'identity-check.tmp')
    if ($LASTEXITCODE -ne 0) {
        & $script:Cli --config-dir $script:Config keys generate $alias *> (Join-Path $script:Config 'identity-generation.tmp')
        if ($LASTEXITCODE -ne 0) { throw "No se pudo generar $alias; revisar localmente la carpeta ignorada." }
    }
    $keys[$role] = Invoke-PublicStep "address-$role" @('keys','address',$alias)
    if ($keys[$role] -notmatch '^G[A-Z2-7]{55}$') { throw "Direccion invalida: $role" }
    Invoke-PublicStep "fund-$role" @('keys','fund',$alias,'--network','testnet') -Resume | Out-Null
}
$hashes = [ordered]@{}
$ids = @{}
foreach ($contract in @('tire_registry','impact_registry','badge_contract')) {
    $wasm = "target/wasm32v1-none/release/$contract.wasm"
    $hashes[$contract] = (Get-FileHash -LiteralPath $wasm -Algorithm SHA256).Hash.ToLower()
    $arguments = @('contract','deploy','--wasm',$wasm,'--source-account',$aliases.company,'--network','testnet')
    if ($contract -eq 'impact_registry') { $arguments += @('--','--tire_registry',$ids.tire_registry) }
    if ($contract -eq 'badge_contract') { $arguments += @('--','--impact_registry',$ids.impact_registry) }
    $ids[$contract] = Invoke-PublicStep "deploy-$contract" $arguments -Resume
    if ($ids[$contract] -notmatch '^C[A-Z2-7]{55}$') { throw "Contract ID invalido: $contract" }
}
$deployment = [ordered]@{ network='testnet'; network_passphrase=$net.passphrase; deployed_at_utc=[DateTime]::UtcNow.ToString('o'); tire_registry=$ids.tire_registry; impact_registry=$ids.impact_registry; badge_contract=$ids.badge_contract; company=$keys.company; carrier=$keys.carrier; plant=$keys.plant; aliases=$aliases; wasm_sha256=$hashes }
$deployment | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $script:Manifest -Encoding utf8
Assert-Links ([pscustomobject]$deployment)
Write-Host 'Despliegue y direcciones verificados.'
