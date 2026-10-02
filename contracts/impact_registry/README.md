# ImpactRegistry — Fase 3

Contrato Soroban separado para acumular el impacto circular de empresas y representar TirePoints sin tokens transferibles. No implementa badges, NFTs, pagos ni aplicación web.

## Arquitectura e integración con TireRegistry

El constructor `__constructor(tire_registry: Address)` fija una única dirección de TireRegistry durante la creación del contrato. Soroban ejecuta el constructor una sola vez. No hay función de inicialización pública posterior, administrador que edite saldos ni función para cambiar la fuente.

`credit_batch(batch_id)` consulta directamente `TireRegistry.get_batch(batch_id)` en esa dirección. El cliente y los tipos se generan con `contractimport!` desde el Wasm de TireRegistry; no se copia su máquina de estados ni se incorporan sus funciones al contrato de producción. TireRegistry permanece sin cambios.

Se usa el mecanismo de [llamadas entre contratos documentado por Stellar](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/cross-contract-call). Es una llamada síncrona dentro de la ejecución Soroban, no una consulta a un backend, oráculo o servicio externo.

La acreditación verifica:

1. Que no existe un recibo previo para ese ID.
2. Que la llamada al contrato configurado devuelve el lote solicitado.
3. Que el lote está en `Valorized`.
4. Que `valorized_mass` y `received_mass` existen, son positivas y la primera no supera la segunda.
5. Que existe un hash de evidencia de 32 bytes distinto del marcador vacío.
6. Que las sumas del saldo y contador no desbordan sus tipos.

Empresa y cantidad proceden exclusivamente del lote; el llamante no puede proporcionarlas. Estos controles de frontera no repiten las etapas de custodia, permisos de transportista/planta ni verificación documental de TireRegistry.

Un lote inexistente devuelve `BatchNotFound`; fuente inaccesible, error inesperado o respuesta incompatible devuelve `SourceUnavailable`. Los fallos no generan recibos ni aumentan saldos.

## Autorización

`credit_batch` es un disparador público sin firma de empresa requerida. Cualquier persona puede pagar la invocación para acreditar un lote elegible, pero el resultado siempre beneficia a la empresa almacenada en TireRegistry y por la cantidad almacenada allí. No hay parámetro de destinatario ni de masa que permita redirigir o inflar impacto. Los tests lo verifican sin autorizaciones simuladas para ImpactRegistry.

La confianza se deposita en la dirección fijada al desplegar: el operador debe comprobar que corresponde al TireRegistry auténtico. La generación del cliente a partir de un ABI no certifica el código de una dirección arbitraria. No se añade un catálogo de plantas ni una validación de identidad legal.

## Almacenamiento

| Dato | Ubicación | Contenido |
| --- | --- | --- |
| `Source` | Instancia | Dirección inmutable de TireRegistry. |
| `Company(company)` | Persistente | `company`, `total_verified_grams: u128`, `credited_batch_count: u64`. |
| `Credit(batch_id)` | Persistente | ID, empresa beneficiaria, gramos acreditados `u64` y timestamp del ledger. |

No se conserva una lista creciente dentro de un único registro: cada recibo tiene su propia clave. Los IDs son únicos dentro de la fuente fija. La identidad completa de una acreditación incluye la dirección de ImpactRegistry y su TireRegistry configurado.

Una empresa sin registros devuelve un impacto de cero asociado a la dirección consultada. Un ID no acreditado devuelve `false` y ningún recibo, sin afirmar si el lote existe en TireRegistry.

## TirePoints y precisión

**1 TirePoint = 1 kg = 1.000 gramos.**

El valor canónico es `total_verified_grams`. No hay floats, redondeo por lote, mint de tokens ni transferencias. Las consultas derivan:

```text
whole           = total_verified_grams / 1000
remainder_grams = total_verified_grams % 1000
```

Ejemplos:

- 4.900.000 g → 4.900 TP completos y 0 g restantes.
- 600 g + 650 g → 1.250 g → 1 TP completo y 250 g restantes (1,250 TP exactos).
- 1 g → 0 TP completos y 1 g restante; ese gramo no se pierde.

Cada lote aporta una masa `u64`; el acumulado `u128` permite sumar múltiples lotes de tamaño `u64` sin truncamiento. Saldo y contador usan `checked_add`; se devuelve `NumericOverflow` sin cambios si no hay capacidad. TirePoints no son dinero, créditos de carbono, ni bienes comprables, vendibles o transferibles.

## API pública

Se omite `Env`, suministrado por Soroban.

| Función | Resultado |
| --- | --- |
| `__constructor(tire_registry)` | Configura la fuente una sola vez al desplegar. |
| `credit_batch(batch_id)` | `BatchCredit`; acredita exactamente una vez. |
| `get_company_impact(company)` | `CompanyImpact`: empresa, gramos y contador. |
| `is_batch_credited(batch_id)` | `bool`. |
| `get_credited_batch_count(company)` | Número de lotes acreditados de esa empresa. |
| `get_tirepoints(company)` | `TirePoints { whole, remainder_grams }`. |
| `get_batch_credit(batch_id)` | Recibo opcional de acreditación. |
| `get_tire_registry()` | Dirección configurada. |

Las funciones normales devuelven `Result<..., ImpactError>`. No hay contador global ni mecanismo de enumeración de todas las empresas en esta fase.

## Doble acreditación y atomicidad

Un recibo persistente por lote bloquea cualquier intento posterior con `AlreadyCredited`. No se puede borrar, reasignar o editar mediante la API. Las operaciones se ejecutan secuencialmente bajo las reglas transaccionales de Soroban: saldo, contador y recibo se escriben en una sola invocación y un fallo revierte esa invocación. El desbordamiento se comprueba antes de escribir.

**Límite explícito de Fase 3:** el cierre en TireRegistry y la acreditación en ImpactRegistry son dos operaciones distintas. Puede existir un lote VALORIZED aún no acreditado. Tras el cierre hay que invocar `credit_batch`; una invocación fallida puede reintentarse y una exitosa no puede duplicarse. No se promete ejecución automática.

Se adopta provisionalmente este flujo para mantener TireRegistry sin modificaciones, consultar directamente su estado terminal y limitar la integración al registro de impacto. Introduce un riesgo de demora u omisión de la acreditación, no autorización para alterar sus datos. La atomicidad entre cierre y reconocimiento exigida por el producto completo sigue pendiente; requerirá una integración explícita y tests de reversión entre contratos antes de prometer ese comportamiento. La atomicidad interna de una acreditación sí está implementada.

## Persistencia y límites del MVP

- Recibos y totales usan almacenamiento persistente, nunca temporal. Las consultas de registros existentes y las escrituras renuevan su TTL cuando es necesario, con objetivo de 518.400 ledgers limitado por la red. La instancia también se renueva.
- Los registros persistentes archivados deben restaurarse conforme a Soroban; no deben borrarse o tratarse como registros nuevos. El mantenimiento operativo de TTL/restauración sigue pendiente. Un recibo archivado no se convierte legítimamente en permiso para reacreditar.
- No existe revocación, edición ni migración de acreditaciones. Antes de un piloto con correcciones se necesita una política explícita.
- La protección contra duplicados se limita al ID en la fuente configurada y a esta instancia de ImpactRegistry. No detecta material físico declarado con varios IDs ni impide desplegar otro ImpactRegistry y acreditar allí el mismo lote. El producto debe identificar un registro canónico por despliegue.
- Un hash y el estado VALORIZED no prueban por sí solos un tratamiento físico. Se conserva el modelo de declaraciones respaldadas por la planta.
- No hay despliegue en Testnet, frontend, almacenamiento de documentos, badges, NFTs, pagos ni oráculos.

## Archivos

- `src/lib.rs`: API, integración, validaciones y cálculos.
- `src/tire.rs`: importación del cliente y ABI de TireRegistry.
- `src/types.rs`: impacto, recibo, presentación de TirePoints y errores.
- `src/storage.rs`: claves persistentes, configuración y TTL.
- `src/test.rs`: pruebas de negocio, integración, límites y fallos.

## Compilación y pruebas

Desde la raíz de TreadProof. En este equipo, habilitar primero el Rust local:

```powershell
. ./scripts/Use-LocalRust.ps1
```

El orden de compilación es obligatorio porque el cliente se genera desde el Wasm de TireRegistry. Usar el destino `target/` estándar; no ejecutar un build de todo el workspace desde cero antes de generar ese Wasm.

```powershell
stellar contract build --package tire-registry --locked --optimize=false
stellar contract build --package impact-registry --locked --optimize=false
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings
cargo test --workspace --locked --offline
cargo test --workspace --features wasm-tests --locked --offline
```

`--optimize=false` evita el fallo del optimizador adicional de Stellar CLI identificado en Fase 2; Rust mantiene el perfil release optimizado. En una máquina sin dependencias descargadas, omitir `--offline` en la primera ejecución.

Sin `wasm-tests`, las pruebas de ImpactRegistry registran ImpactRegistry Rust nativo y consultan el Wasm real de TireRegistry. Con esa función activada, registran ambos Wasm y ejecutan las llamadas entre ellos en el host Soroban. Se evita enlazar TireRegistry como dependencia de desarrollo: esa combinación con `cdylib` y `testutils` supera el límite de símbolos exportados de DLL en este entorno Windows. Los 40 tests propios de TireRegistry conservan sus modos nativo/Wasm originales. Los casos de datos corruptos usan únicamente herramientas de prueba para alterar almacenamiento; la API real no permite fabricar esos estados.

## Resultados de verificación de Fase 3

| Comprobación | Resultado |
| --- | --- |
| `cargo fmt --all -- --check` | Correcto. |
| Clippy, workspace, todos los targets y funciones, `-D warnings` | Correcto, sin advertencias. |
| Tests Rust | ImpactRegistry 29/29 y TireRegistry 40/40: **69 aprobados**. |
| Tests con `wasm-tests` | ImpactRegistry 29/29 y TireRegistry 40/40: **69 aprobados**. |
| Compilación Wasm de ImpactRegistry | Correcta, 9.773 bytes, ocho funciones exportadas incluido el constructor. |
| Integridad de TireRegistry | Todos sus archivos originales mantienen el SHA-256 registrado antes de Fase 3. |

No hubo tests fallidos ni omitidos. Se cubren acreditación válida, estados no valorizados y excepciones, beneficiario, duplicados, acumulación y separación de empresas, conversión exacta y fracciones, ausencia de lote, masas/evidencias inválidas, disparo público sin redirección, empresa sin impacto, límites u64/u128, desbordamientos sin escrituras parciales, fuente fija/inaccesible, colisiones de ID entre fuentes, reintentos, preservación del lote y TTL. El Wasm no se ha desplegado en una red.
