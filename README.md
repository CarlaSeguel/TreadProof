# TreadProof

**Trace. Verify. Reward.**

Plataforma de trazabilidad verificable de neumáticos fuera de uso (NFU), construida sobre Stellar y Soroban. Registra lotes y su cadena de custodia, acredita gramos valorizados y reconoce empresas mediante TirePoints y credenciales no transferibles.

Repositorio oficial: https://github.com/CarlaSeguel/TreadProof

## Estado — MVP v0.1

Fases 0 a 5 completadas: definición, reglas, TireRegistry, ImpactRegistry, BadgeContract y despliegue con demo end-to-end en Stellar Testnet. Fase 6 (Supabase y backend) pendiente del checkpoint inicial en GitHub. No hay frontend implementado.

## Arquitectura actual

`TireRegistry → ImpactRegistry → BadgeContract`

- **TireRegistry:** actores Stellar fijos por lote, masas enteras en gramos, hash de evidencia y flujo CREATED → PICKED_UP → IN_TRANSIT → RECEIVED → VALORIZED, con excepciones controladas.
- **ImpactRegistry:** consulta TireRegistry y acredita una sola vez cada lote valorizado a su empresa. Conserva gramos verificados; 1.000 gramos equivalen a 1 TirePoint.
- **BadgeContract:** consulta ImpactRegistry y registra credenciales acumulativas no transferibles, sin balances declarados por el usuario.

Las referencias canónicas se fijan en constructores. Cierre, acreditación y desbloqueo son operaciones separadas. El sistema valida declaraciones registradas por los actores: no demuestra por sí solo el tratamiento físico ni detecta el mismo material declarado en dos lotes diferentes. TirePoints y badges no representan dinero, créditos de carbono ni certificaciones oficiales.

## Stellar Testnet

| Contrato | Dirección |
| --- | --- |
| TireRegistry | `CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS` |
| ImpactRegistry | `CC5NLEIIWPEEWVZZWJXQQ55VXWR7XWFSY3R2DJXRKCKULMDUD34GYL5U` |
| BadgeContract | `CCCIKAMAWIPURGD2NXENEO3H5FD4L4VADM7O366DJFJC7NAZKJ7DYKKA` |

El manifiesto para herramientas es [deployments/testnet.json](deployments/testnet.json). [Documentación Testnet](docs/testnet/README.md), [transacciones y hashes](docs/testnet/deployments.md), [demo completo](docs/testnet/demo_flow.md).

Demo sintético TP-DEMO-0001 / lote 1: 4.900.000 gramos valorizados, **4.900 TirePoints y TRACE I**. Testnet puede reiniciarse; consultar estado y gestionar TTL antes de reutilizar el despliegue.

## Desarrollo y pruebas

Rust **1.98.1**, target `wasm32v1-none`, Soroban SDK **28.0.0**, Stellar CLI **28.0.0**. El toolchain se fija en `rust-toolchain.toml`; instalar Rust y Stellar CLI desde sus fuentes oficiales. En este equipo puede habilitarse la instalación local ignorada con `. ./scripts/Use-LocalRust.ps1`.

Los clientes importan ABI desde Wasm: compilar siempre en este orden desde la raíz:

```powershell
stellar contract build --package tire-registry --locked --optimize=false
stellar contract build --package impact-registry --locked --optimize=false
stellar contract build --package badge-contract --locked --optimize=false
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings
cargo test --workspace --locked
cargo test --workspace --features wasm-tests --locked
```

El modo offline requiere dependencias previamente descargadas. `--optimize=false` omite el optimizador adicional del CLI; Rust sigue compilando en release. Baterías: TireRegistry 40, ImpactRegistry 29, BadgeContract 29: **98 Rust y 98 Wasm**.

## Organización y seguridad

- `docs/`: reglas del producto y evidencia de Testnet.
- `contracts/`: los tres contratos Rust/Soroban y sus tests.
- `deployments/`: manifiestos públicos.
- `scripts/testnet/`: despliegue, demo y verificación reproducibles.
- `backend/`, `supabase/`, `frontend/`: reservados para próximas etapas.

Contract IDs y public keys de prueba son públicos. Claves privadas, seeds, credenciales y `.env` deben permanecer fuera de Git. `.tools/stellar-testnet/`, `target/` y archivos sensibles están ignorados; no publicar esas carpetas. No se incluyen pagos, escrow, stablecoins, IoT, oráculos ni Mainnet.

Reglas principales: [definición](docs/00_project_definition.md), [flujo](docs/04_workflow.md), [TirePoints](docs/05_tirepoints.md), [badges](docs/06_badges.md), [alcance](docs/07_mvp_scope.md).
