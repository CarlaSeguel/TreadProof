# Flujo DEMO — TP-DEMO-0001

Ejecutado el 2026-10-02 en Stellar Testnet. **Lote sintético**, batch_id **1**: no representa valorización física real. Resultado final: **Valorized → 4.900 TP → TRACE I**. RECOVER, CIRCULAR, IMPACT y CHAMPION permanecen sin desbloquear.

Los comandos siguientes son reconstrucciones exactas de los argumentos ejecutados, con comillas compatibles con PowerShell 7. Ejecutar desde la raíz de TreadProof y con `stellar` en PATH. Son evidencia histórica: no copiar las mutaciones para repetirlas sobre el mismo lote; usar los scripts que controlan la reanudación.

Evidencia sintética: [TP-DEMO-0001.txt](evidence/TP-DEMO-0001.txt). SHA-256: `6c5f78dde113ab9230b1ea4546df0d369ad98b77b93925ea92ab37e808657ff0`.

## demo-01-create

UTC: 2026-10-02T13:20:48.1004430Z. [Registro completo](evidence/demo-01-create.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'yes' '--' 'create_batch' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI' '--carrier' 'GD66X5HC256LFZYWW22ERBSNGC3ISUTWV5ZYJVVCQPAAXAK5NCQD7D2L' '--plant' 'GDNQRJFA2PV5HGGISZG3I77BFNVIELZ6YHAPVYQ73BYM2KCOVWOMF5FU' '--declared_mass' '5000000'
```

Esperado: Nuevo lote 1, estado Created, actores asignados y masa declarada 5.000.000 g.

Obtenido: código de salida 0.

```text
1
```

Transacción: [8955da167c3cdb0440c7223c96d6863b76f85fbb5d6e10c5590b727463d13d8c](https://stellar.expert/explorer/testnet/tx/8955da167c3cdb0440c7223c96d6863b76f85fbb5d6e10c5590b727463d13d8c) — `tx_success`.

## demo-02-pickup

UTC: 2026-10-02T13:20:53.7870460Z. [Registro completo](evidence/demo-02-pickup.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS' '--source-account' 'tp-demo-carrier' '--network' 'testnet' '--send' 'yes' '--' 'confirm_pickup' '--id' '1' '--pickup_mass' '4980000'
```

Esperado: PickedUp; masa retirada 4.980.000 g, conservando la declarada.

Obtenido: código de salida 0.

```text
null
```

Transacción: [c14f841739a382381e4f9cbb84465009d2de9a158bb3b7f5bb9060387ddeb5eb](https://stellar.expert/explorer/testnet/tx/c14f841739a382381e4f9cbb84465009d2de9a158bb3b7f5bb9060387ddeb5eb) — `tx_success`.

## demo-03-transit

UTC: 2026-10-02T13:20:58.0235128Z. [Registro completo](evidence/demo-03-transit.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS' '--source-account' 'tp-demo-carrier' '--network' 'testnet' '--send' 'yes' '--' 'start_transit' '--id' '1'
```

Esperado: InTransit, sin cambios de masas.

Obtenido: código de salida 0.

```text
null
```

Transacción: [83d1506066e6f3372873427a74406eb75ba4358a806b57258a791d2ba870644c](https://stellar.expert/explorer/testnet/tx/83d1506066e6f3372873427a74406eb75ba4358a806b57258a791d2ba870644c) — `tx_success`.

## demo-04-reception

UTC: 2026-10-02T13:21:04.0079079Z. [Registro completo](evidence/demo-04-reception.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS' '--source-account' 'tp-demo-plant' '--network' 'testnet' '--send' 'yes' '--' 'confirm_reception' '--id' '1' '--received_mass' '4950000'
```

Esperado: Received; masa recibida 4.950.000 g, sin disputa automática.

Obtenido: código de salida 0.

```text
null
```

Transacción: [340a6153828919ed8229a46b9dd7ad51c2ba32adbcd0a2f8b57c1a68a034bfbc](https://stellar.expert/explorer/testnet/tx/340a6153828919ed8229a46b9dd7ad51c2ba32adbcd0a2f8b57c1a68a034bfbc) — `tx_success`.

## demo-05-valorization

UTC: 2026-10-02T13:21:07.8928049Z. [Registro completo](evidence/demo-05-valorization.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS' '--source-account' 'tp-demo-plant' '--network' 'testnet' '--send' 'yes' '--' 'confirm_valorization' '--id' '1' '--valorized_mass' '4900000' '--evidence_hash' '6c5f78dde113ab9230b1ea4546df0d369ad98b77b93925ea92ab37e808657ff0'
```

Esperado: Valorized; masa valorizada 4.900.000 g y hash DEMO.

Obtenido: código de salida 0.

```text
null
```

Transacción: [1c52d40934c5f99ab3a85a82cb9fcf80ff4739cefb33afb16d6125b1db6f9b61](https://stellar.expert/explorer/testnet/tx/1c52d40934c5f99ab3a85a82cb9fcf80ff4739cefb33afb16d6125b1db6f9b61) — `tx_success`.

## demo-06-credit

UTC: 2026-10-02T13:21:13.0996723Z. [Registro completo](evidence/demo-06-credit.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'yes' '--' 'credit_batch' '--batch_id' '1'
```

Esperado: Empresa del lote; 4.900.000 g acreditados; un lote; 4.900 TP.

Obtenido: código de salida 0.

```text
{"batch_id":1,"company":"GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI","credited_at":1790947272,"verified_grams":4900000}
```

Transacción: [448078b8c48d43d465a5fd4b4d0f8e30198391d568ee65f6e6f0f8dac3899e13](https://stellar.expert/explorer/testnet/tx/448078b8c48d43d465a5fd4b4d0f8e30198391d568ee65f6e6f0f8dac3899e13) — `tx_success`.

## demo-07-unlock

UTC: 2026-10-02T13:21:18.3175147Z. [Registro completo](evidence/demo-07-unlock.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'yes' '--' 'check_and_unlock' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI'
```

Esperado: Una nueva credencial Trace; ningún nivel superior.

Obtenido: código de salida 0.

```text
[{"company":"GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI","credited_batch_count":1,"impact_registry":"CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U","level":"Trace","rules_version":1,"threshold_grams":"1000000","unlocked_at":1790947277,"unlocked_ledger":4984738,"verified_grams":"4900000"}]
```

Transacción: [e246a31da47ec2030a8bb43a892570b0dbef7ec641ef602b085e3a173b352d04](https://stellar.expert/explorer/testnet/tx/e246a31da47ec2030a8bb43a892570b0dbef7ec641ef602b085e3a173b352d04) — `tx_success`.

## negative-duplicate-credit

UTC: 2026-10-02T13:21:31.6586825Z. [Registro completo](evidence/negative-duplicate-credit.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'credit_batch' '--batch_id' '1'
```

Esperado: Rechazo AlreadyCredited / Error(Contract, #2) en simulación, sin envío.

Obtenido: código de salida 1.

```text
❌ error: transaction simulation failed: HostError: Error(Contract, #2)

Event log (newest first):
   0: [Diagnostic Event] contract:CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U, topics:[error, Error(Contract, #2)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"
   1: [Diagnostic Event] topics:[fn_call, CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U, credit_batch], data:1
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## negative-duplicate-valorization

UTC: 2026-10-02T13:21:32.6320312Z. [Registro completo](evidence/negative-duplicate-valorization.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS' '--source-account' 'tp-demo-plant' '--network' 'testnet' '--send' 'no' '--' 'confirm_valorization' '--id' '1' '--valorized_mass' '4900000' '--evidence_hash' '6c5f78dde113ab9230b1ea4546df0d369ad98b77b93925ea92ab37e808657ff0'
```

Esperado: Rechazo InvalidState / Error(Contract, #3) en simulación, sin envío.

Obtenido: código de salida 1.

```text
❌ error: transaction simulation failed: HostError: Error(Contract, #3)

Event log (newest first):
   0: [Diagnostic Event] contract:CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS, topics:[error, Error(Contract, #3)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"
   1: [Diagnostic Event] topics:[fn_call, CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS, confirm_valorization], data:[1, 4900000, Bytes(6c5f78dde113ab9230b1ea4546df0d369ad98b77b93925ea92ab37e808657ff0)]
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## negative-repeat-unlock

UTC: 2026-10-02T13:21:38.5661946Z. [Registro completo](evidence/negative-repeat-unlock.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'yes' '--' 'check_and_unlock' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI'
```

Esperado: Lista vacía []; credencial original sin cambios.

Obtenido: código de salida 0.

```text
[]
```

Transacción: [27ab17a5fe6d4c1bcc69b0610beea210dcd2f2723c432a2c3ac0141a2f606213](https://stellar.expert/explorer/testnet/tx/27ab17a5fe6d4c1bcc69b0610beea210dcd2f2723c432a2c3ac0141a2f606213) — `tx_success`.

## verify-all-badges

UTC: 2026-10-02T13:21:49.8079323Z. [Registro completo](evidence/verify-all-badges.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'get_company_badges' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
[{"company":"GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI","credited_batch_count":1,"impact_registry":"CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U","level":"Trace","rules_version":1,"threshold_grams":"1000000","unlocked_at":1790947277,"unlocked_ledger":4984738,"verified_grams":"4900000"}]
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-badge-Champion

UTC: 2026-10-02T13:21:47.9297451Z. [Registro completo](evidence/verify-badge-Champion.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'has_badge' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI' '--badge_level' '"Champion"'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
false
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-badge-Circular

UTC: 2026-10-02T13:21:46.3085127Z. [Registro completo](evidence/verify-badge-Circular.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'has_badge' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI' '--badge_level' '"Circular"'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
false
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-badge-Impact

UTC: 2026-10-02T13:21:47.0986703Z. [Registro completo](evidence/verify-badge-Impact.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'has_badge' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI' '--badge_level' '"Impact"'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
false
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-badge-Recover

UTC: 2026-10-02T13:21:45.4209930Z. [Registro completo](evidence/verify-badge-Recover.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'has_badge' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI' '--badge_level' '"Recover"'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
false
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-badge-Trace

UTC: 2026-10-02T13:21:44.5721643Z. [Registro completo](evidence/verify-badge-Trace.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'has_badge' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI' '--badge_level' '"Trace"'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
true
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-batch

UTC: 2026-10-02T13:21:41.0282454Z. [Registro completo](evidence/verify-batch.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'get_batch' '--id' '1'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
{"carrier":"GD66X5HC256LFZYWW22ERBSNGC3ISUTWV5ZYJVVCQPAAXAK5NCQD7D2L","company":"GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI","created_at":1790947247,"declared_mass":5000000,"evidence_hash":"6c5f78dde113ab9230b1ea4546df0d369ad98b77b93925ea92ab37e808657ff0","history":[{"actor":"GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI","from":"Creation","reason":null,"timestamp":1790947247,"to":"Created"},{"actor":"GD66X5HC256LFZYWW22ERBSNGC3ISUTWV5ZYJVVCQPAAXAK5NCQD7D2L","from":{"State":"Created"},"reason":null,"timestamp":1790947252,"to":"PickedUp"},{"actor":"GD66X5HC256LFZYWW22ERBSNGC3ISUTWV5ZYJVVCQPAAXAK5NCQD7D2L","from":{"State":"PickedUp"},"reason":null,"timestamp":1790947257,"to":"InTransit"},{"actor":"GDNQRJFA2PV5HGGISZG3I77BFNVIELZ6YHAPVYQ73BYM2KCOVWOMF5FU","from":{"State":"InTransit"},"reason":null,"timestamp":1790947262,"to":"Received"},{"actor":"GDNQRJFA2PV5HGGISZG3I77BFNVIELZ6YHAPVYQ73BYM2KCOVWOMF5FU","from":{"State":"Received"},"reason":null,"timestamp":1790947267,"to":"Valorized"}],"id":1,"pickup_mass":4980000,"plant":"GDNQRJFA2PV5HGGISZG3I77BFNVIELZ6YHAPVYQ73BYM2KCOVWOMF5FU","received_mass":4950000,"status":"Valorized","updated_at":1790947267,"valorized_mass":4900000}
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-count

UTC: 2026-10-02T13:21:42.4665079Z. [Registro completo](evidence/verify-count.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'get_credited_batch_count' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
1
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-credited

UTC: 2026-10-02T13:21:43.2920955Z. [Registro completo](evidence/verify-credited.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'is_batch_credited' '--batch_id' '1'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
true
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-highest

UTC: 2026-10-02T13:21:48.5934512Z. [Registro completo](evidence/verify-highest.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'get_highest_badge' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
"Trace"
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-impact

UTC: 2026-10-02T13:21:41.8543130Z. [Registro completo](evidence/verify-impact.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'get_company_impact' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
{"company":"GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI","credited_batch_count":1,"total_verified_grams":"4900000"}
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-record

UTC: 2026-10-02T13:21:49.1240326Z. [Registro completo](evidence/verify-record.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'get_badge_record' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI' '--badge_level' '"Trace"'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
{"company":"GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI","credited_batch_count":1,"impact_registry":"CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U","level":"Trace","rules_version":1,"threshold_grams":"1000000","unlocked_at":1790947277,"unlocked_ledger":4984738,"verified_grams":"4900000"}
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## verify-tirepoints

UTC: 2026-10-02T13:21:43.9866948Z. [Registro completo](evidence/verify-tirepoints.json).

```powershell
& 'stellar' '--config-dir' '.tools/stellar-testnet' 'contract' 'invoke' '--id' 'CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U' '--source-account' 'tp-demo-company' '--network' 'testnet' '--send' 'no' '--' 'get_tirepoints' '--company' 'GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI'
```

Esperado: consulta consistente con lote 1, empresa fijada, masas originales, 4.900.000 gramos, contador 1 y solamente Trace. Las aserciones específicas están en `scripts/testnet/verify.ps1`.

Obtenido: código de salida 0.

```text
{"remainder_grams":0,"whole":"4900"}
```

Sin transacción publicada: consulta o rechazo durante simulación RPC (`--send no`).

## Resultado de las verificaciones

Todas las aserciones de `verify.ps1` pasaron antes y después de las pruebas negativas. El registro Trace conserva exactamente el timestamp, ledger, titular, umbral, acumulado y demás campos de la emisión original. Las respuestas `null` de retiro/tránsito/recepción/valorización representan retorno sin valor; el estado final y su historial completo se muestran en `verify-batch` y acreditan las transiciones.
