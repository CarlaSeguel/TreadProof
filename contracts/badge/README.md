# BadgeContract — Circular Badge Credentials (Fase 4)

Contrato Soroban separado para credenciales on-chain no transferibles de empresas. Reconoce niveles de impacto circular dentro de TreadProof; no representa certificación ambiental oficial, crédito de carbono, activo financiero ni token comercial. No es un NFT transferible.

## Niveles y unidades

1 TirePoint = 1 kg = 1.000 gramos. Las comparaciones se hacen directamente sobre `total_verified_grams: u128`, sin floats, división previa, redondeo ni saldo declarado por el usuario.

| Nivel | Enum Rust | TirePoints | Umbral en gramos |
| --- | --- | ---: | ---: |
| TRACE I | `Trace` | 1.000 | 1.000.000 |
| RECOVER II | `Recover` | 10.000 | 10.000.000 |
| CIRCULAR III | `Circular` | 25.000 | 25.000.000 |
| IMPACT IV | `Impact` | 50.000 | 50.000.000 |
| CHAMPION V | `Champion` | 100.000 | 100.000.000 |

Se exige `total_verified_grams >= umbral`. Por ejemplo, 999.999 g no permiten TRACE; 1.000.000 g sí. Los umbrales son fijos para esta versión de reglas (1).

## Arquitectura e integración

El constructor fija una dirección canónica de ImpactRegistry al crear BadgeContract. No existe función para cambiar esa dirección después ni inicialización pública que pueda apropiarse del contrato.

`src/impact.rs` genera el cliente y tipos con `contractimport!` desde el Wasm real de ImpactRegistry. `check_and_unlock(company)` realiza una llamada síncrona a `get_company_impact(company)` en esa dirección. Solo acepta una respuesta válida cuya empresa coincide con la solicitada. No permite pasar un saldo, una dirección alternativa de registro, un nivel deseado ni un beneficiario adicional.

Si el contrato de origen no está disponible, tiene una interfaz incompatible o devuelve un error, se devuelve `SourceUnavailable` sin emitir credenciales. Una respuesta para otra empresa devuelve `InvalidCompany`.

TireRegistry e ImpactRegistry permanecen sin modificaciones. BadgeContract no vuelve a validar lotes ni acreditar gramos: consume el acumulado de ImpactRegistry. El operador que despliegue debe verificar que la dirección configurada es el ImpactRegistry auténtico y canónico; importar su ABI no autentica cualquier dirección arbitraria con una interfaz compatible.

## Disparo público y comportamiento acumulativo

Cualquier usuario puede ejecutar `check_and_unlock(company)` sin autorización de la empresa. El resultado es determinista y beneficia exclusivamente a esa empresa, usando su acumulado registrado. No puede redirigirse una insignia ni elegirse manualmente el saldo. El usuario que envíe la transacción asumirá sus costes de red.

La función recorre los cinco niveles en orden y registra todos los que se cumplen y aún no existen. Devuelve únicamente las credenciales nuevas. Una repetición devuelve una lista vacía y conserva los registros originales, incluyendo fechas e impacto al desbloquear. Alcanzar CHAMPION conserva los cuatro niveles inferiores. No se concede una misma credencial dos veces por empresa y nivel en esta instancia.

El desbloqueo es una operación explícita posterior a la acreditación de impacto. Acreditar un lote no llama automáticamente a BadgeContract. Las consultas devuelven credenciales ya registradas, no niveles potencialmente elegibles que aún no se han desbloqueado. La fecha es la de desbloqueo, no necesariamente la del primer instante en que se alcanzó el umbral.

## Almacenamiento y evidencia

- **Instancia:** dirección fija de ImpactRegistry.
- **Persistente por empresa:** vector ordenado y acotado a cinco `BadgeRecord`. Un único registro permite guardar juntos todos los desbloqueos de la invocación y evita listas de tamaño indefinido.

Cada `BadgeRecord` conserva:

| Campo | Significado |
| --- | --- |
| `company` | Empresa titular. |
| `level` | Nivel de la credencial. |
| `unlocked_at` | Timestamp Unix del ledger de desbloqueo. |
| `unlocked_ledger` | Número de ledger al desbloquear. |
| `verified_grams` | Acumulado exacto de ImpactRegistry en ese momento. |
| `credited_batch_count` | Número de lotes acreditados en ese momento. |
| `threshold_grams` | Umbral utilizado. |
| `rules_version` | Versión de reglas: 1. |
| `impact_registry` | Dirección de origen de ese acumulado. |

Los registros existentes no se reemplazan al aumentar el impacto. Los nuevos niveles reciben la nueva instantánea. Las escrituras del desbloqueo ocurren en la misma invocación Soroban y se revierten si falla; no forman una transacción única con el cierre o acreditación realizados anteriormente.

Las consultas de credenciales no invocan ImpactRegistry: pueden devolver el historial emitido aunque el origen esté temporalmente inaccesible. Renovar el TTL no modifica sus campos de evidencia.

## Funciones públicas

Se omite `Env`, suministrado por Soroban. Salvo el constructor, retornan `Result<..., BadgeError>`.

| Función | Resultado |
| --- | --- |
| `__constructor(impact_registry)` | Fija el origen una sola vez durante el despliegue. |
| `check_and_unlock(company)` | `Vec<BadgeRecord>` con las nuevas credenciales; vacío si no hay nuevas. |
| `get_company_badges(company)` | Todas las credenciales registradas en orden ascendente. |
| `has_badge(company, badge_level)` | `bool` según registro existente. |
| `get_highest_badge(company)` | `Option<BadgeLevel>`; `None` sin credenciales. |
| `get_badge_record(company, badge_level)` | `Option<BadgeRecord>`. |
| `get_impact_registry()` | Dirección configurada. |

No hay transferencia, venta, aprobación de operadores, mint arbitrario, setter de balance ni cambio de titular. Tampoco se implementan NFTs tradicionales, frontend o Supabase.

## Limitaciones del MVP

- Debe elegirse una cadena canónica de despliegues: TireRegistry → ImpactRegistry → BadgeContract. Un segundo BadgeContract independiente puede registrar sus propias credenciales; la unicidad se garantiza dentro de esta instancia.
- La fuente configurada es una relación de confianza. Una dirección maliciosa que imite la interfaz y fabrique balances no se convierte en ImpactRegistry auténtico por superar los controles de formato.
- No hay revocación, expiración de negocio, edición ni migración. Las credenciales son evidencia histórica del desbloqueo, no una revalidación continua. Antes de introducir correcciones de impacto deben definirse sus efectos.
- El estado de la planta y los hashes no prueban por sí solos la valorización física ni detectan material duplicado entre IDs.
- Cierre, acreditación y desbloqueo son operaciones separadas; falta automatización o coordinación atómica si se requiere para el producto completo.
- Se renueva el TTL de la instancia y registros consultados/escritos, con objetivo de 518.400 ledgers limitado por la red. El almacenamiento es persistente y puede archivarse: mantenimiento y restauración operativa quedan pendientes. El archivo técnico no es revocación ni permiso para reemitir.
- Los registros son públicos on-chain. No se incluyen documentos ni datos personales adicionales.
- Esta fase no despliega contratos en Testnet.

## Archivos y comandos

- `src/lib.rs`: API y reglas de desbloqueo.
- `src/types.rs`: niveles, umbrales, evidencia y errores.
- `src/storage.rs`: configuración, credenciales persistentes y TTL.
- `src/impact.rs`: cliente de ImpactRegistry generado desde su ABI.
- `src/test.rs`: pruebas de umbrales, integración y fallos.

Desde la raíz de TreadProof, con Rust disponible. En este equipo se habilita el toolchain local con:

```powershell
. ./scripts/Use-LocalRust.ps1
```

Compilar en este orden antes de ejecutar tests desde una copia limpia, porque cada cliente importado necesita el Wasm del contrato anterior. Se usa la carpeta `target/` estándar.

```powershell
stellar contract build --package tire-registry --locked --optimize=false
stellar contract build --package impact-registry --locked --optimize=false
stellar contract build --package badge-contract --locked --optimize=false
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings
cargo test --workspace --locked --offline
cargo test --workspace --features wasm-tests --locked --offline
```

Omitir `--offline` si las dependencias aún no están descargadas. `--optimize=false` omite el optimizador adicional de Stellar CLI que falló en este equipo en Fase 2; Rust conserva su compilación release optimizada.

Los tests de BadgeContract usan TireRegistry e ImpactRegistry Wasm reales. En modo normal registran BadgeContract Rust nativo; con `wasm-tests` registran también BadgeContract Wasm. La inyección de instantáneas inválidas se realiza solo con herramientas internas de prueba, nunca mediante una API desplegada. Las baterías existentes de los contratos anteriores se ejecutan junto a las nuevas.

## Resultados de verificación de Fase 4

| Comprobación | Resultado |
| --- | --- |
| Tests Rust | BadgeContract 29/29, ImpactRegistry 29/29, TireRegistry 40/40: **98 aprobados**. |
| Tests Wasm | La misma batería: **98 aprobados**. |
| Formato | `cargo fmt --all -- --check`: correcto. |
| Clippy | Workspace, todos los targets y funciones, `-D warnings`: correcto, sin advertencias. |
| Compilación Wasm | Correcta: `badge_contract.wasm`, 9.701 bytes y siete funciones exportadas. |
| Conservación de contratos anteriores | Todos los archivos originales de TireRegistry e ImpactRegistry mantienen sus hashes SHA-256 previos a Fase 4. |

No hay tests fallidos ni omitidos. Los 29 tests nuevos cubren ausencia de impacto; cada nivel al umbral exacto; un gramo por debajo y por encima de cada umbral; acumulación; duplicados; evidencia histórica inmutable; empresas independientes; consultas y nivel máximo; desbloqueo explícito; lotes no acreditados; activación pública sin redirección; fuente inaccesible/incompatible; empresa incorrecta en la respuesta; constructor no reutilizable; rechazo de registros alternativos; conservación de datos anteriores; fracciones y límite u128; consultas históricas ante fallo del origen; ausencia de transferencias y TTL.

Artefacto: `target/wasm32v1-none/release/badge_contract.wasm`. SHA-256: `af86361eef95b5b994ee6992a15e181f76768fd00b6f9da2b9d24a008de89ea7`. No se ha desplegado en ninguna red.
