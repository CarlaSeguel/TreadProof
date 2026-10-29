# TreadProof — evidencia pública D1

Cinco operaciones de demostración registradas como SUCCESS en Stellar Testnet, sobre el lote on-chain **#2**, con estado final **Valorized**, ledger **5453544** y cuatro masas de **1000 g**. La tabla completa de hashes, ledgers y procedencias está en `manifest.json`; el verificador genera el resumen desde esa única fuente.

**VALORIZACIÓN SIMULADA — DOCUMENTO DE DEMOSTRACIÓN TÉCNICA. No acredita tratamiento, reciclaje ni valorización física real de neumáticos.** El PDF conserva sus bytes originales y el SHA-256 comprometido en la quinta operación.

## Verificación

Requiere Node.js 24 y npm. Instalar únicamente las dependencias fijadas por el lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs
```

Para comprobar también la autenticidad frente al hash del manifiesto comunicado por un canal independiente:

```sh
node verify.mjs --manifest-sha256 HASH_SHA256_COMUNICADO
```

Sin ese hash externo se comprueba coherencia interna, pero la procedencia del manifiesto se informa como **NO VERIFICABLE**. El manifiesto cubre los otros doce archivos; no contiene circularmente su propio hash.

El verificador distingue:

- **cryptographic**: hashes, firma Ed25519 del envelope y hash de retorno Soroban; no son una prueba de inclusión en consenso.
- **integrity**: estructura y hashes de los archivos del paquete.
- **archived**: contrato, argumentos tipados, resultados, tiempos históricos, transiciones y estado, comprobados contra información archivada.
- **stellar_live**: consultas opcionales actuales al RPC y Horizon públicos de Testnet.
- **not_proven**: límites que este paquete no acredita.

Cada comprobación devuelve **PASS**, **FAIL** o **NO VERIFICABLE**. Un FAIL produce código de salida 1. Los límites explícitos NO VERIFICABLE no se convierten en PASS ni se confunden con una transacción fallida. Los tiempos se comprueban en la fecha histórica de inclusión, no exigiendo que hoy sigan vigentes los XDR archivados.

Opcionalmente, si se autoriza una consulta de red de solo lectura:

```sh
node verify.mjs --online --manifest-sha256 HASH_SHA256_COMUNICADO
```

Solo consulta `getTransaction` y el recurso de transacciones de Horizon Testnet, sin claves ni JWT. No simula, firma, envía ni invoca contratos. Una respuesta NOT_FOUND, un recurso no conservado o un proveedor inaccesible se informa como NO VERIFICABLE; no niega un SUCCESS histórico. No se necesita el backend TreadProof, el journal privado ni Supabase.

## Qué se conserva

Cada operación tiene un `xdr.json` con los mismos campos `envelope_xdr`, `result_xdr` y `result_meta_xdr`. Son contenedores nuevos: sus valores Base64 se copiaron literalmente y sus bytes decodificados coinciden con las fuentes seleccionadas. No se presentan como cuerpos HTTP originales. El formato de cada XDR se valida sin normalizarlo.

`batch-state.json` es una respuesta pública archivada de `getLedgerEntries` para la misma entrada persistente que carga `get_batch`. No se invocó el getter, que extiende TTL. La comprobación offline demuestra correspondencia con el estado del quinto recibo; no consulta el estado actual ni extiende TTL.

`.gitattributes` se limita a este directorio y evita filtros, sustitución de identificadores, codificación y normalización de finales de línea que alterarían las huellas. Las dependencias instaladas en `node_modules` son herramientas de ejecución, no uno de los trece archivos publicados.

## Límites históricos

- **Preimágenes históricas exactas: 4/5.** Falta la original de `start_transit`; se conserva una variante actual de metadata con los mismos hechos verificados. Su digest histórico no se sustituye ni se declara reproducido.
- El digest histórico se calcula como SHA-256 sobre la concatenación UTF-8 de `result_xdr` y `result_meta_xdr` Base64, sin separador. Es distinto del hash del JSON y del XDR binario.
- **El código histórico completo D1 no está reconstruido.** El baseline consignado no es un release D1. Este verificador y su lockfile constituyen herramientas del paquete público, no una reconstrucción del backend histórico.
- La versión del formato (`schema_version`), fecha original de archivado, fecha de generación pública y versiones del verificador/dependencias están separadas en el manifiesto. No se inventa una versión de software D1.
- No se acreditan aquí Auth, SEP-53, RLS, aprobaciones administrativas privadas, tratamiento físico ni una prueba criptográfica completa de consenso/inclusión del ledger. Tampoco se demuestra restauración de PostgreSQL ni cierre de los hallazgos SQL-direct.
- D1 permanece **En revisión, con aceptación formal pendiente**. Este paquete no equivale a aceptación contractual ni a producción.

Los hashes y direcciones de Stellar son públicos. No se incluyen identidades internas Auth/organización, referencias de Storage privado, rutas del equipo ni journal. El PDF aprobado contiene un nombre organizacional ficticio y el UUID técnico del lote, ya evaluados como publicables; no identifica un usuario Auth ni certifica una organización física.

El archivo privado completo y su copia independiente se conservan sin cambios. La retención de Testnet y de sus APIs es limitada; una futura desaparición de respuestas no se sustituirá por resultados inventados.
