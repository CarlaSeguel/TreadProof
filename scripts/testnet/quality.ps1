. "$PSScriptRoot/common.ps1"
. "$script:Root/scripts/Use-LocalRust.ps1"
$checks = @(
    @{ Name='fmt'; Args=@('fmt','--all','--','--check') },
    @{ Name='clippy'; Args=@('clippy','--workspace','--all-targets','--all-features','--locked','--offline','--','-D','warnings') },
    @{ Name='rust'; Args=@('test','--workspace','--locked','--offline') },
    @{ Name='wasm'; Args=@('test','--workspace','--features','wasm-tests','--locked','--offline') }
)
foreach ($check in $checks) {
    $arguments = $check.Args
    $log = Join-Path $script:Evidence ('quality-' + $check.Name + '.txt')
    & cargo @arguments *> $log
    if ($LASTEXITCODE -ne 0) { throw "Fallo en $($check.Name). Ver $log" }
    if ($check.Name -in @('rust','wasm')) {
        $matches = [regex]::Matches((Get-Content $log -Raw), 'test result: ok\. (\d+) passed; 0 failed; 0 ignored')
        $count = 0
        foreach ($match in $matches) { $count += [int]$match.Groups[1].Value }
        Assert-Equal $count 98 "Tests $($check.Name)"
    }
    Write-Host "PASS: $($check.Name)"
}
