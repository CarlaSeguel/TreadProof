param([switch]$Staged)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($Staged) {
    $paths = @(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR)
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer el indice Git.' }
} else {
    $paths = @(rg --files --hidden -g '!.git/**' -g '!.tools/**' -g '!target/**' -g '!**/test_snapshots/**')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron enumerar los archivos.' }
}
$knownSecrets = @()
if (Test-Path .tools/stellar-testnet) {
    Get-ChildItem .tools/stellar-testnet -Filter *.toml -Recurse | ForEach-Object {
        $privateText = [string](Get-Content $_.FullName -Raw)
        foreach ($match in [regex]::Matches($privateText, '(?:seed_phrase|secret_key)\s*=\s*"([^"]+)"')) {
            $knownSecrets += $match.Groups[1].Value
        }
    }
}
$patterns = [ordered]@{
    stellar_secret = '(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])'
    private_key = '-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----'
    github_token = '(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})'
    jwt = 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
    credential_url = '://[^\s/:]+:[^\s/@]+@'
    secret_assignment = '(?im)^\s*(?:export\s+)?(?:[A-Z0-9_]*(?:SECRET|PRIVATE_KEY|SERVICE_ROLE_KEY|TOKEN|PASSWORD|SEED_PHRASE)[A-Z0-9_]*)\s*[:=]\s*["'']?[A-Za-z0-9_+/=-]{12,}'
}
$findings = @()
foreach ($path in $paths) {
    if ($path -match '(^|[/\\])(?:\.tools|target|secrets|node_modules)([/\\]|$)|\.(secret|seed|key|pem|p12|pfx)$|(^|[/\\])\.env(?!\.example$)') {
        $findings += "$path : ruta sensible"
        continue
    }
    if ($Staged) {
        $publicText = (git show ":$path") -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "No se pudo leer staged: $path" }
    } else { $publicText = [string](Get-Content -LiteralPath $path -Raw) }
    if ([string]::IsNullOrEmpty($publicText)) { continue }
    foreach ($pattern in $patterns.GetEnumerator()) {
        if ([regex]::IsMatch($publicText, $pattern.Value)) { $findings += "$path : $($pattern.Key)" }
    }
    foreach ($secret in $knownSecrets) {
        if ($publicText.Contains($secret)) { $findings += "$path : coincide con secreto local" }
    }
}
if ($findings.Count) {
    $findings | Select-Object -Unique | Write-Output
    throw 'Auditoria fallida; no hacer commit. Valores omitidos.'
}
Write-Output "PASS: $($paths.Count) archivos revisados; sin patrones de secretos ni coincidencias con $($knownSecrets.Count) secretos locales. Staged=$Staged"
