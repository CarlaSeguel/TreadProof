$ErrorActionPreference = 'Stop'
$script:Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location -LiteralPath $script:Root
$script:Cli = (Get-Command stellar -ErrorAction SilentlyContinue).Source
if (-not $script:Cli) { $script:Cli = 'C:\Program Files (x86)\Stellar CLI\stellar.exe' }
if (-not (Test-Path -LiteralPath $script:Cli)) { throw 'Stellar CLI no disponible.' }
$script:Config = Join-Path $script:Root '.tools/stellar-testnet'
$script:Evidence = Join-Path $script:Root 'docs/testnet/evidence'
$script:Manifest = Join-Path $script:Root 'deployments/testnet.json'
New-Item -ItemType Directory -Force $script:Config,$script:Evidence,(Split-Path $script:Manifest) | Out-Null
$script:Network = @('--network','testnet')

# Only public contract/network commands belong here. Never pass secret material.
function Invoke-PublicStep {
    param([string]$Name, [string[]]$Arguments, [switch]$Resume, [string]$ExpectedError)
    $file = Join-Path $script:Evidence ($Name + '.json')
    if ($Resume -and (Test-Path $file)) {
        $saved = Get-Content $file -Raw | ConvertFrom-Json
        $expectedCommand = @('stellar','--config-dir','.tools/stellar-testnet') + $Arguments
        if (($saved.command | ConvertTo-Json -Compress) -cne ($expectedCommand | ConvertTo-Json -Compress)) { throw "La evidencia de $Name corresponde a otro comando. No se reenvia automaticamente." }
        if ($saved.exit_code -eq 0) { Write-Host "Reutilizando evidencia: $Name"; return $saved.stdout }
        throw "Existe un intento fallido de $Name; revisar antes de reintentar."
    }
    $out = Join-Path $script:Config 'public-stdout.tmp'
    $err = Join-Path $script:Config 'public-stderr.tmp'
    & $script:Cli --config-dir $script:Config @Arguments 1> $out 2> $err
    $code = $LASTEXITCODE
    $stdout = (Get-Content $out -Raw -ErrorAction SilentlyContinue)
    $stderr = (Get-Content $err -Raw -ErrorAction SilentlyContinue)
    if ($null -eq $stdout) { $stdout = '' }
    if ($null -eq $stderr) { $stderr = '' }
    $stdout = $stdout.Trim()
    $hashes = @([regex]::Matches($stderr, '(?:transaction hash[: ]+|/tx/)([a-fA-F0-9]{64})', 'IgnoreCase') | ForEach-Object { $_.Groups[1].Value.ToLower() } | Select-Object -Unique)
    $record = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); command = @('stellar','--config-dir','.tools/stellar-testnet') + $Arguments; exit_code = $code; stdout = $stdout; stderr = $stderr; transaction_hashes = $hashes }
    $record | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $file -Encoding utf8
    Write-Host "$Name : exit=$code"
    if ($ExpectedError) {
        if ($code -eq 0 -or ($stderr + $stdout) -notmatch $ExpectedError) { throw "No se obtuvo el rechazo esperado: $Name. Ver $file" }
    } elseif ($code -ne 0) { throw "Fallo en $Name. Ver $file" }
    return $stdout
}

function Invoke-Contract {
    param([string]$Name,[string]$Contract,[string]$Signer,[string[]]$Call,[switch]$Query,[switch]$Resume,[string]$ExpectedError)
    $send = 'yes'
    if ($Query) { $send = 'no' }
    Invoke-PublicStep -Name $Name -Arguments (@('contract','invoke','--id',$Contract,'--source-account',$Signer,'--network','testnet','--send',$send,'--') + $Call) -Resume:$Resume -ExpectedError $ExpectedError
}

function Assert-Equal($Actual, $Expected, [string]$Label) {
    if ([string]$Actual -cne [string]$Expected) { throw "$Label : esperado $Expected; obtenido $Actual" }
    Write-Host "OK: $Label"
}

function Assert-Links($Deployment) {
    $tire = Invoke-Contract 'link-tire' $Deployment.impact_registry $Deployment.aliases.company @('get_tire_registry') -Query | ConvertFrom-Json
    $impact = Invoke-Contract 'link-impact' $Deployment.badge_contract $Deployment.aliases.company @('get_impact_registry') -Query | ConvertFrom-Json
    Assert-Equal $tire $Deployment.tire_registry 'ImpactRegistry -> TireRegistry'
    Assert-Equal $impact $Deployment.impact_registry 'BadgeContract -> ImpactRegistry'
}
