# TireRegistry — nota técnica de Fase 2

Contrato inicial de registro NFU. Las reglas de negocio están en [docs](../../docs/04_workflow.md). Esta entrega implementa solamente trazabilidad, sin TirePoints, badges ni contratos externos.

## Diseño

- `src/lib.rs`: funciones públicas y validaciones del flujo.
- `src/types.rs`: `TireBatch`, estados, historial y errores explícitos.
- `src/storage.rs`: lotes en almacenamiento persistente, contador de IDs en almacenamiento de instancia y extensión de TTL.
- `src/test.rs`: pruebas unitarias usando el entorno de Soroban, incluidos permisos positivos y negativos.
- `Cargo.toml`: paquete `tire-registry`, dependiente de `soroban-sdk` 28.0.0; `testutils` solo para pruebas.
- El workspace y su configuración de compilación están en la raíz de TreadProof. Rust se fija en `rust-toolchain.toml`; las dependencias resueltas se fijan en `Cargo.lock`.

## Modelo y límites

Cada lote almacena `id`, `company`, `carrier`, `plant`, cuatro masas, hash opcional de evidencia, estado, fecha de creación, última actualización e historial de transiciones. Las direcciones de los actores no pueden cambiarse.

Las masas son `u64` en gramos, de 1 a 18.446.744.073.709.551.615 g cuando están presentes. No se usan floats ni se convierten unidades dentro del contrato. 4.950 kg se envían como `4_950_000`. Una medición pendiente se representa con `Option::None`.

Los IDs son enteros crecientes desde 1, únicos dentro del contrato. Una referencia global debe incluir la dirección del contrato. La suma del contador es comprobada: al agotarse falla sin reutilizar IDs.

La evidencia es un `BytesN<32>` destinado a un hash SHA-256 calculado fuera del contrato. El tipo exige exactamente 32 bytes y se rechaza el valor de 32 bytes cero como marcador vacío. No se almacenan documentos ni se comprueba aquí que el hash corresponda a un documento auténtico o disponible.

Las fechas provienen de `env.ledger().timestamp()` y representan segundos Unix del ledger. Varias operaciones en un mismo ledger pueden tener la misma fecha. El orden también queda registrado en el historial. Cada cambio conserva actor, estado anterior y nuevo, fecha y motivo cuando corresponde. El historial está acotado por el flujo sin reaperturas (como máximo cinco entradas).

## API pública

En estas firmas se omite `Env`, suministrado por Soroban. Todas las masas están en gramos.

| Función | Resultado | Autorización |
| --- | --- | --- |
| `create_batch(company, carrier, plant, declared_mass)` | ID `u64` | `company.require_auth()` |
| `confirm_pickup(id, pickup_mass)` | `()` | Transportista almacenado en el lote |
| `start_transit(id)` | `()` | Transportista almacenado en el lote |
| `confirm_reception(id, received_mass)` | `()` | Planta almacenada en el lote |
| `confirm_valorization(id, valorized_mass, evidence_hash)` | `()` | Planta almacenada en el lote |
| `get_batch(id)` | `TireBatch` completo | Consulta pública |
| `cancel_batch(id, reason)` | `()` | Empresa, únicamente desde CREATED |
| `reject_batch(id, reason)` | `()` | Planta, desde IN_TRANSIT o RECEIVED |
| `dispute_batch(id, actor, reason)` | `()` | Firma de uno de los tres actores del lote, antes de VALORIZED |

Las tres funciones de excepción implementan las reglas ya definidas en Fase 1. Los motivos deben contener de 1 a 256 bytes y no estar compuestos solo por espacios ASCII. CANCELLED, REJECTED, DISPUTED y VALORIZED bloquean cualquier transición posterior.

Los nombres Rust de los estados son `Created`, `PickedUp`, `InTransit`, `Received`, `Valorized`, `Disputed`, `Rejected` y `Cancelled`, equivalentes a las etiquetas en mayúsculas de la documentación funcional.

Los errores de negocio son `RegistryError`. Una firma ausente o incorrecta produce un error de autorización del host Soroban; no se sustituye por una comparación de direcciones suministradas por el llamante. El contrato no permite edición ni eliminación de lotes.

## Identidad, privacidad y persistencia

La empresa firma la creación y designa las direcciones participantes. Cada actor firma sus propias transiciones. No hay registro global de plantas certificadas ni acreditación institucional: controlar una dirección no prueba la identidad legal o capacidad de una planta. Tampoco se exige que las tres direcciones sean diferentes, pues esa restricción no forma parte de las reglas acordadas.

Los datos del contrato son públicos. No introducir documentos, secretos, información personal o comercial sensible en los motivos. La restricción de consultas de una futura aplicación no convierte en privados los datos publicados en cadena.

Cada escritura o consulta válida de un lote renueva el TTL de ese lote y de la instancia cuando están por debajo del umbral. La retención objetivo es 518.400 ledgers, limitada por la configuración real de la red. Los datos persistentes inactivos pueden archivarse; su restauración y mantenimiento operativo quedan para una etapa posterior. No se usa almacenamiento temporal para lotes ni IDs.

## Compilación y pruebas

Desde la raíz de TreadProof, con Rust disponible:

```powershell
cargo test -p tire-registry --locked
cargo fmt --all -- --check
cargo clippy -p tire-registry --all-targets --locked -- -D warnings
stellar contract build --package tire-registry --locked --optimize=false
cargo test -p tire-registry --features wasm-tests --locked
```

En este equipo se preparó Rust localmente bajo `.tools/`, sin cambiar el PATH global. Para habilitarlo en una terminal PowerShell nueva:

```powershell
. ./scripts/Use-LocalRust.ps1
```

En otro equipo se puede usar Rust instalado normalmente con el toolchain y destino indicados en `rust-toolchain.toml`. `.tools/`, `target/` y las capturas generadas por los tests no se versionan.

El destino Wasm es `wasm32v1-none`. Para generar el contrato se usa Stellar CLI, conforme a la [documentación de Soroban SDK 28](https://docs.rs/soroban-sdk/28.0.0/soroban_sdk/). El artefacto esperado es `target/wasm32v1-none/release/tire_registry.wasm`.

En este equipo, la optimización adicional de Stellar CLI 28.0.0 falló con `Failed to read module`. Se usa `--optimize=false` para omitir únicamente ese paso; la compilación Rust sigue siendo release con optimización y LTO. La función de pruebas `wasm-tests` carga el artefacto compilado en el host Soroban y ejecuta la misma batería contra Wasm, en lugar de registrar el contrato Rust nativo. Requiere compilar primero y usar la carpeta `target/` estándar.

## Diferencia temporal respecto del producto completo

Por instrucción expresa de esta fase, `confirm_valorization` registra el cierre sin acreditar puntos ni insignias. La atomicidad futura entre registro e ImpactRegistry todavía no está implementada ni comprobada. No se despliega esta entrega a Testnet ni se crean wallets; solo se prepara y prueba localmente el contrato.

## Verificación local — 28 de septiembre de 2026

- `cargo test -p tire-registry --locked --offline`: **40 tests aprobados, 0 fallidos, 0 omitidos**.
- `cargo test -p tire-registry --features wasm-tests --locked --offline`: **los mismos 40 tests aprobados contra el Wasm compilado**, sin fallos ni omisiones.
- `stellar contract build --package tire-registry --locked --optimize=false`: correcto; artefacto de 12.178 bytes con nueve funciones exportadas.
- `cargo fmt --all -- --check`: correcto.
- `cargo clippy -p tire-registry --all-targets --locked --offline -- -D warnings`: correcto, sin advertencias.

Los tests cubren creación válida y masa cero; autorización de la empresa; IDs únicos y desbordamiento; retiro válido, inválido y sin autorización; tránsito; recepción con peso mayor o menor y planta incorrecta; valorización válida, excesiva, nula, duplicada y sin evidencia; saltos y retrocesos; conservación de actores, masas e historial; consulta inexistente; cancelaciones, rechazos y disputas; motivos de excepción; precisión de un gramo, límite u64 y extensión de TTL.

Estas pruebas ejecutan el contrato en el entorno local de Soroban. No prueban una operación industrial real ni una transacción desplegada en Testnet.
