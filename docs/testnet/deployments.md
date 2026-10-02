# Despliegues — Stellar Testnet

Fecha: 2026-10-02 (America/Santiago). Finalización del despliegue UTC: 2026-10-02T13:19:52.8548935Z.
Red: **Stellar Testnet**. Frase: `Test SDF Network ; September 2015`. RPC: `https://soroban-testnet.stellar.org/`. Protocolo observado: 29. Rust 1.98.1; Stellar CLI 28.0.0; SDK Soroban 28.0.0.

| Contrato | Contract ID | SHA-256 Wasm local y on-chain |
| --- | --- | --- |
| tire_registry | `CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS` | `13e4cf397b1fa987376108b012b3c86a30d759beed1472bde494a180b80fcfda` |
| impact_registry | `CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U` | `23116e4d2beebfb2e45c89f57b6a1e3ed250638031cb5af7b38cefa8f115fbe4` |
| badge_contract | `CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA` | `af86361eef95b5b994ee6992a15e181f76768fd00b6f9da2b9d24a008de89ea7` |

Los constructores fijaron exactamente TireRegistry en ImpactRegistry e ImpactRegistry en BadgeContract. Las consultas `get_tire_registry` y `get_impact_registry` coincidieron antes del demo y después. Evidencia: [link-tire](evidence/link-tire.json), [link-impact](evidence/link-impact.json), [hashes recuperados](evidence/onchain-wasm-hashes.json).

## Identidades públicas

| Rol | Alias local | Public key |
| --- | --- | --- |
| company | `tp-demo-company` | `GAKJ5RYDSIWDHRIXGSAYIYEYP2LKNQD6D6F5BEBOEOLNWRFFURRP5WTI` |
| carrier | `tp-demo-carrier` | `GD66X5HC256LFZYWW22ERBSNGC3ISUTWV5ZYJVVCQPAAXAK5NCQD7D2L` |
| plant | `tp-demo-plant` | `GDNQRJFA2PV5HGGISZG3I77BFNVIELZ6YHAPVYQ73BYM2KCOVWOMF5FU` |

Company despliega y crea solicitudes; carrier firma retiro y tránsito; plant firma recepción y valorización. Company paga también las invocaciones públicas de acreditación y desbloqueo. Se financiaron únicamente estas tres identidades mediante Friendbot. Secretos locales: carpeta ignorada `.tools/stellar-testnet/`; no se incluyen en esta entrega pública.

## Transacciones confirmadas

Las primeras dos transacciones de cada contrato corresponden a carga del Wasm y creación de la instancia con su constructor. Todas las filas tienen resultado `tx_success`, recuperado mediante `stellar tx fetch result`.

| Operación | Hash verificable | Resultado |
| --- | --- | --- |
| deploy-badge_contract | [39eaa41716ca7b4c846e04d3ff259f72d8c905e053e6ec1af307d120fd04461a](https://stellar.expert/explorer/testnet/tx/39eaa41716ca7b4c846e04d3ff259f72d8c905e053e6ec1af307d120fd04461a) | tx_success |
| deploy-badge_contract | [4d25204d73cd061cf0772e40376f7b50cfbe56d53d5ea6623f4a8bd628cbfb3e](https://stellar.expert/explorer/testnet/tx/4d25204d73cd061cf0772e40376f7b50cfbe56d53d5ea6623f4a8bd628cbfb3e) | tx_success |
| deploy-impact_registry | [a4c9e7f86737293e7108f021b2ea23e8969b530c6d7a431e626e06447841d025](https://stellar.expert/explorer/testnet/tx/a4c9e7f86737293e7108f021b2ea23e8969b530c6d7a431e626e06447841d025) | tx_success |
| deploy-impact_registry | [4b1389b460f32f80bc6b46717383a9e4e06424e6e1870ad2dd86c83d90d8b036](https://stellar.expert/explorer/testnet/tx/4b1389b460f32f80bc6b46717383a9e4e06424e6e1870ad2dd86c83d90d8b036) | tx_success |
| deploy-tire_registry | [885301f71ed91857d5349e161bd1ea087290cb7c94e0513e683df7242df5a6db](https://stellar.expert/explorer/testnet/tx/885301f71ed91857d5349e161bd1ea087290cb7c94e0513e683df7242df5a6db) | tx_success |
| deploy-tire_registry | [1f17a132b59507f3edd6607db0dc6da5f3f8ff565b709687ec2ac5445c4c1b8e](https://stellar.expert/explorer/testnet/tx/1f17a132b59507f3edd6607db0dc6da5f3f8ff565b709687ec2ac5445c4c1b8e) | tx_success |
| demo-01-create | [8955da167c3cdb0440c7223c96d6863b76f85fbb5d6e10c5590b727463d13d8c](https://stellar.expert/explorer/testnet/tx/8955da167c3cdb0440c7223c96d6863b76f85fbb5d6e10c5590b727463d13d8c) | tx_success |
| demo-02-pickup | [c14f841739a382381e4f9cbb84465009d2de9a158bb3b7f5bb9060387ddeb5eb](https://stellar.expert/explorer/testnet/tx/c14f841739a382381e4f9cbb84465009d2de9a158bb3b7f5bb9060387ddeb5eb) | tx_success |
| demo-03-transit | [83d1506066e6f3372873427a74406eb75ba4358a806b57258a791d2ba870644c](https://stellar.expert/explorer/testnet/tx/83d1506066e6f3372873427a74406eb75ba4358a806b57258a791d2ba870644c) | tx_success |
| demo-04-reception | [340a6153828919ed8229a46b9dd7ad51c2ba32adbcd0a2f8b57c1a68a034bfbc](https://stellar.expert/explorer/testnet/tx/340a6153828919ed8229a46b9dd7ad51c2ba32adbcd0a2f8b57c1a68a034bfbc) | tx_success |
| demo-05-valorization | [1c52d40934c5f99ab3a85a82cb9fcf80ff4739cefb33afb16d6125b1db6f9b61](https://stellar.expert/explorer/testnet/tx/1c52d40934c5f99ab3a85a82cb9fcf80ff4739cefb33afb16d6125b1db6f9b61) | tx_success |
| demo-06-credit | [448078b8c48d43d465a5fd4b4d0f8e30198391d568ee65f6e6f0f8dac3899e13](https://stellar.expert/explorer/testnet/tx/448078b8c48d43d465a5fd4b4d0f8e30198391d568ee65f6e6f0f8dac3899e13) | tx_success |
| demo-07-unlock | [e246a31da47ec2030a8bb43a892570b0dbef7ec641ef602b085e3a173b352d04](https://stellar.expert/explorer/testnet/tx/e246a31da47ec2030a8bb43a892570b0dbef7ec641ef602b085e3a173b352d04) | tx_success |
| negative-repeat-unlock | [27ab17a5fe6d4c1bcc69b0610beea210dcd2f2723c432a2c3ac0141a2f606213](https://stellar.expert/explorer/testnet/tx/27ab17a5fe6d4c1bcc69b0610beea210dcd2f2723c432a2c3ac0141a2f606213) | tx_success |

Los archivos `evidence/deploy-*.json` conservan comando, argumentos, fecha UTC, salida y hashes de cada despliegue; `evidence/receipt-*.json` conserva las consultas de sus resultados. Las consultas y rechazos en simulación no generan una transacción publicada.
