. "$PSScriptRoot/common.ps1"
$d = Get-Content $script:Manifest -Raw | ConvertFrom-Json
Assert-Equal $d.network 'testnet' 'Red de auditoria'
$hashResults = [ordered]@{}
foreach ($contract in @('tire_registry','impact_registry','badge_contract')) {
    $dest = ".tools/stellar-testnet/$contract.fetched.wasm"
    Invoke-PublicStep "fetch-$contract" @('contract','fetch','--id',$d.$contract,'--network','testnet','--out-file',$dest) | Out-Null
    $hashResults[$contract] = (Get-FileHash $dest).Hash.ToLower()
    Assert-Equal $hashResults[$contract] $d.wasm_sha256.$contract "Wasm on-chain $contract"
}
$hashResults | ConvertTo-Json | Set-Content (Join-Path $script:Evidence 'onchain-wasm-hashes.json') -Encoding utf8
$steps = @(Get-ChildItem $script:Evidence -Filter 'deploy-*.json') + @(Get-ChildItem $script:Evidence -Filter 'demo-*.json') + @(Get-Item (Join-Path $script:Evidence 'negative-repeat-unlock.json'))
$transactions = @()
foreach ($step in $steps) {
    $record = Get-Content $step.FullName -Raw | ConvertFrom-Json
    $index = 0
    foreach ($hash in $record.transaction_hashes) {
        $index++
        $receipt = Invoke-PublicStep "receipt-$($step.BaseName)-$index" @('tx','fetch','result','--hash',$hash,'--network','testnet','--output','json') | ConvertFrom-Json
        if ($null -eq $receipt.result.tx_success) { throw "Transaccion sin tx_success: $hash" }
        $transactions += [ordered]@{ step=$step.BaseName; hash=$hash; status='tx_success'; explorer="https://stellar.expert/explorer/testnet/tx/$hash" }
    }
}
$transactions | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $script:Evidence 'confirmed-transactions.json') -Encoding utf8
Write-Host "$($transactions.Count) transacciones confirmadas, Wasm verificados."
