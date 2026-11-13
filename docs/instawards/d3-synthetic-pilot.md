# D3.5 · Paquete operativo NFU para piloto sintético

Corte documental del 13 de noviembre de 2026. SOW v2.5, §§5–9 y §11. El ensayo M4 acredita la ejecución de un ciclo sintético por Patricia. Las masas y el PDF son datos de ensayo. La attestation de Plant vincula esos datos con una cuenta y una transacción en Testnet. La afiliación es una declaración revisada por un operador y el tratamiento físico queda fuera del alcance.

## Checklist operativo

- [ ] **Participantes.** Confirmar tres usuarios y organizaciones sintéticos distintos y su relación usuario → organización → rol → dirección pública. Usar tres cuentas nuevas en Testnet para una reproducción autorizada. Confirmar saldo de Testnet, contrato TireRegistry, origen HTTPS y journal aislado. Conservar el lote D2 #3 y el lote M4 #4 como expedientes cerrados.
- [ ] **Consentimiento y acceso.** Explicar a los participantes el propósito sintético, los datos que se guardan, qué referencias quedan públicas en Testnet y quién puede consultar los archivos privados. Registrar conformidad y alcance en el expediente del operador. El revisor usa una cuenta separada de los tres roles, con permiso de solo lectura para un lote, fecha de vencimiento y revocación disponible. Mantener privado el PDF y cualquier documento de identidad.
- [ ] **Identidad y firma.** Verificar SEP-53 para la cuenta activa. En el flujo D3, el operador aprueba la solicitud de asociación Plant y Plant firma el desafío `treadproof-wallet-association-v1`, de cinco minutos y un solo uso. Registrar posesión, revisión de afiliación y permiso de revisor por separado. Para cada transacción, comprobar rol, lote, argumentos, red, comisión y vigencia antes de que la persona apruebe la firma.
- [ ] **Mediciones.** Registrar cuatro valores independientes en gramos enteros. Validar masa positiva y conversión exacta. Explicar las diferencias en el registro sintético y detenerse ante un dato incoherente. La masa valorizada debe ser igual o menor que la recibida.
- [ ] **PDF y SHA-256.** Plant prepara un PDF marcado como sintético, vinculado al lote y a la masa valorizada. Autorizar su referencia y guardar los bytes en Storage privado. Recuperar el archivo, comparar tamaño y SHA-256, y usar ese hash en la attestation. Si la carga queda incompleta o el hash difiere, detener la valorización.
- [ ] **Revisión y verificación.** Con un permiso vigente, consultar la página del revisor y exportar JSON y HTML. Revisar la fuente y fecha de cada dato. Descargar el PDF autorizado, ejecutar el verificador RPC con esos archivos y guardar el resultado con su fecha, ledger y ventana histórica.
- [ ] **Discrepancias y conexión.** Ante cancelación, vencimiento o rechazo, registrar la causa y revisar el journal antes de preparar otra acción. Ante `pending`, `unknown`, timeout o respuesta perdida, conservar el ID y el hash. Consultar ese mismo hash por RPC y conciliar con HIGH2 cuando corresponda. Mantener un solo despacho por intención. Si la interfaz contradice el resultado, comprobar el recibo y el digest antes de decidir.
- [ ] **Retención y cierre.** Conservar los cinco recibos, hashes y ledgers, las respuestas Stellar disponibles y los informes fechados con el release. Guardar el PDF y los respaldos en el expediente privado, sin credenciales. Revocar el permiso de prueba al cierre. Si el RPC pierde el historial, conservar el corte como archivado y registrar `UNVERIFIED` para la comprobación actual. El período de 30 días corresponde a la disponibilidad de la demo. La retención RPC depende del proveedor. `Valorized`, el crédito de TirePoints y el desbloqueo de badges son resultados separados. Este procedimiento termina en `Valorized`.

## Procedimiento

1. **Preparación.** En una copia aislada del operador, validar por rol las vinculaciones y el acceso. Usar el perfil local de revisión antes de abrir ventanas de envío. Verificar la wallet y Testnet en Varial/Freighter y cerrar la sesión antes de cambiar de rol. Los comandos y preflights están en `tools/M4-REAL-CYCLE.md` del worktree M4. Sus ventanas apuntan al ensayo original. Para una reproducción nueva, fijar el alcance de la nueva ejecución antes de habilitar envíos.
2. **Ejecución autorizada.** Usar una ventana exclusiva por fila. Revisar el XDR y simular antes de la firma, con las guardas del perfil M4 de 420/220/170/130 segundos y el tope de 1.000.000 stroops. La persona firma y envía una sola vez. Antes de pasar de fila, comprobar Stellar SUCCESS y el mismo hash y ledger en el journal confirmado. El lote #4 ya completó todas las filas.

   | Rol | Operación | Masa (g) | Estado esperado |
   | --- | --- | ---: | --- |
   | Company | `create_batch` | 5.000.000 | `Created` |
   | Carrier | `confirm_pickup` | 4.980.000 | `PickedUp` |
   | Carrier | `start_transit` | — | `InTransit` |
   | Plant | `confirm_reception` | 4.950.000 | `Received` |
   | Plant | `confirm_valorization` | 4.900.000 | `Valorized` |

   Después de crear el lote, verificar las tres vinculaciones del nuevo ID antes de habilitar Carrier. Completar la recuperación y el hash del PDF antes de la última fila.

3. **Consulta del revisor.** El operador registra la revisión de afiliación, emite un permiso con vencimiento y comunica el UUID del lote. El revisor inicia sesión en `/reviewer.html`, consulta ese UUID y descarga JSON, HTML y, si corresponde, el PDF. Confirmar el rechazo de otro lote, de un permiso revocado o vencido y de escrituras. Este recorrido de D3.3 se verificó localmente. Su uso con las cuentas y el Storage remotos queda pendiente.
4. **Verificación independiente.** Con los archivos ya obtenidos, ejecutar el [verificador D3.4](d3-independent-verification.md). Conservar su salida, aun si es `FAIL` o `UNVERIFIED`. Para revisar el ensayo existente, usar el JSON derivado del recibo sellado y el PDF ya guardado. Una nueva reproducción con escritura requiere otro lote y autorización separada.

## Ensayo realizado por Patricia · M4, lote #4

**Fecha:** 13 de noviembre de 2026, de 00:44:54 a 07:21:29 UTC según los cierres de ledger. En Santiago, de 21:44:54 del día 12 a 04:21:29 del día 13. **Entorno:** operador HTTPS local `127.0.0.1:18444`, Supabase Auth/Storage, PostgreSQL 17.11 aislado y Stellar Testnet. La base Git del worktree M4 era `ce8ecd0b29e20ae84eac09c8bc8208e54e578b3a` con cambios locales del perfil M4. El bundle de valorización verificado fue `m4-B_F6HyHy.js`, SHA-256 `d36b21ffcd60687a4272459b6c401240210b263209f26e13b24d1885e28f458a`. El patch exacto de Chrome y Varial durante las firmas queda sin verificar.

Patricia, distinta del implementador, operó las tres cuentas nuevas y aprobó personalmente las firmas. Usó el computador y la instalación Varial/Freighter compartida administrada por el equipo. Las tres direcciones y las autorizaciones por rol quedaron demostradas. La custodia exclusiva e independiente de cada clave queda sin verificar.

| Cuenta | Dirección pública Testnet |
| --- | --- |
| TP-M4-Company | `GCHEQOMOWJPDHITKDRUQSMD2B3TFY2RGQFAWH6UY2OE6QEVXNKVNNVLF` |
| TP-M4-Carrier | `GDC5PPUWPBYQWBAZ7MG5E5K7XD5J5NQNBROUFBYUDOO63QUC3C3WMT2G` |
| TP-M4-Plant | `GCOAWDO3NJ2453NSWRNI5NEHBCSVAS3OZNR5PWWJLIREQKUAIGG34R5S` |

**Fixture:** TireRegistry `CABWQG36C7ZNGREQUJBZOMSWG4T3KVR2RH2OGRLUM2GMTCBYWOEV6KYS`, Wasm `13e4cf397b1fa987376108b012b3c86a30d759beed1472bde494a180b80fcfda` según el [manifiesto Testnet](../../deployments/testnet.json). Lote on-chain `4`, UUID `7dca8d6e-b405-458e-a0bf-2478e6c8c4b4`. PDF de valorización de **2.038 bytes**, evidenceId `89702c90-1c8a-4b7d-a303-a3dfcbb3d2be`, SHA-256 `341d0d8bc92ada2eec96bfb552b6b2ee9e2e54900620325bb65d4259025f7c7a`.

| Operación | Hora UTC | Ledger | Hash de Stellar | Recibo HIGH2 / `result_digest` |
| --- | --- | ---: | --- | --- |
| `create_batch` | 00:44:54 | 5701410 | `c3316fad745e7863e92a81145bad1104b3bfcccdbce65251389e7c766c3825c1` | E1 · `a4cce72e2c0fd6fcd26a3e41c0d76ad2053b57dd14ccbda53a98929c8c3599f0` |
| `confirm_pickup` | 02:15:29 | 5702497 | `88db9ae092c7fc17cbad924674fbbf85cd972496f3aa0e3cfd649cc0d757ce3a` | E2 · `0fab3ad1ddd7ebfaee2e0495d6437c73af324eb7c65f519c2029c04af8e37a07` |
| `start_transit` | 03:48:39 | 5703615 | `809499b39ed68a37b108d50f518424f8eb14878820bd632def69a214624aefa0` | E3 · `38dea64759f2216e47a9db0f697b94b381f3d59647d3aa95e8d840a0140413d9` |
| `confirm_reception` | 04:33:04 | 5704148 | `a1ba19ff2ba89f7e8f82bd15d6efb2ca1c507557d75f6078b768c25ddf12f8aa` | E3 · `cefecdaa625bcf01ff1200a2ff4cc843b0b24109b23a23acafeeab16f3bad407` |
| `confirm_valorization` | 07:21:29 | 5706169 | `fb8646a3790d92b6673964b02e1b78be03a22bad939aaeda638afaae9aa0cd6c` | E4 · `a3e9903676d4dc71c82fc7f3c8046ec7e3f3af265b5c405a53cc7ba78e7b0046` |

Los cinco resultados llegaron a `confirmed` en el journal. Un intento previo de creación, vencido y sin inclusión verificada, quedó retirado con transmisión incierta y conservado en el historial. El retiro se concilió sobre el mismo hash después de detectar que la métrica `invoke_time_nsecs` variaba entre lecturas RPC.

### Índice de fuentes existentes

Las rutas E1–E6 parten de `%LOCALAPPDATA%/TreadProof/labs`. Los recibos y el respaldo se conservan en su ubicación de origen.

| Fuente | Artefacto |
| --- | --- |
| E1 | `m4-create-batch-lote4-high2.json` |
| E2 | `m4-pickup-lote4-high2-terminal.receipt.json` |
| E3 | `m4-confirm-valorization-lote4-journal-install/journal.pgcustom` y `backup-manifest.json`. Filas confirmadas de `nfu_store.attempts` identificadas por hash. SHA-256 del respaldo `25e55ab2926f68c3f84220acdda2121517c61263804954a20bd152713756a8c7`. |
| E4 | `m4-valorization-lote4-high2-terminal.receipt.json`. El recibo acredita la preservación de los cuatro anteriores. |
| E5 | `m4-valorization-evidence-review/upload-outcomes.jsonl` y `treadproof-m4-lote4-valorizacion-sintetica.pdf`. La carga final fue PASS. |
| E6 | `d3-independent-verification/M4-BATCH4-D3-RPC-VERIFICATION-CLI.json` y `M4-BATCH4-D3-VERIFICATION-INPUT.json` en el mismo directorio. |

E6 registró **PASS** el 13 de noviembre de 2026 a las 16:20:58 UTC, usando el RPC Testnet y el archivo local. Verificó la firma Plant, `confirm_valorization`, ledger 5706169, estado `Valorized`, masa 4.900.000 g y SHA-256. La ventana reportada fue 5591683–5712642. El JSON de entrada se derivó de E4 en el esquema D3.3.

D1/D2 aportan los controles de roles, SEP-53, journal y evidencia privada. La [demo HTTPS D2](https://treadproof-d2-demo.onrender.com/) y su lote #3 se mantienen como referencia separada. Su aceptación funcional se registró en `d2-secretfiles-cut-20261110T224940Z/D2-PLANT-PDF-HTTPS-ACCEPTANCE-20261112T011707121171Z.json`, commit `ce8ecd0b29e20ae84eac09c8bc8208e54e578b3a`. [Inventario D2](evidence/d2-final/TEST-INVENTORY.json)

## Matriz de aceptación

`PASS` se aplica al entorno indicado. `PENDING` identifica una integración o artefacto pendiente. `UNVERIFIED` identifica un resultado que el expediente disponible no acredita.

| SOW | Estado | Evidencia y alcance |
| --- | --- | --- |
| §6, §9 · ciclo, tres roles, cuatro masas y attestation | PASS | M4 real en Testnet, E1–E5. Cinco operaciones en orden. El ensayo usó cuentas distintas con instalación compartida. |
| §6, §9 · actor o red incorrectos; carga incompleta | PASS | Ensayo HTTPS M4 del 12/11, 7/7 en conjunto, documentado en `tools/M4-REHEARSAL.md` del worktree M4. Casos en `tools/m4-https-cycle.test.mjs`. La carga real E5 acredita el caso positivo. |
| §6, §9 · cancelación de firma transaccional y todos los límites de masa | UNVERIFIED | El expediente acredita cancelación de SEP-53, cancelación de una intención y rechazo de masa fuera del perfil. Falta vincular evidencia de cancelación en la wallet para firma transaccional y de cero, negativos, precisión excesiva, rango y masa superior a la recibida para el release final. |
| §6, §9 · timeout, reintento y duplicados | PASS | Ensayo M4 con pérdida de respuesta y reinicio del journal, cinco despachos simulados para cinco operaciones. E1–E4 acreditan conciliación del mismo hash y un intento confirmado por operación. |
| §8.A, §9 · asociación Plant, firma, expiración y replay | PASS | D3.2 local, 307/307, commit `ff15183131a1f2c066844413537e0ed9846abf29`. Incluye HTTP 200/409 para consumo concurrente y HTTP 409 para replay. |
| §8.B, §9 · afiliación, permiso por lote y rechazo de escrituras | PASS | D3.1 local, 26/26, commit `89968c571db3a165542fff5054eb68fb702e1b79`. D3.3 prueba ausencia, otro lote, expiración, revocación y escrituras. |
| §8.C, §9 · página, JSON/HTML, precisión y PDF privado | PASS | D3.3 local, 333/333, commit `862feb7b00bbf6a2103983e97b52f4ac708d3da0`. Misma instantánea en ambos formatos, enteros exactos y bloqueo si el permiso se revoca antes de entregar el PDF. |
| §8.A–C, §11 M3 · recorrido HTTPS final | PENDING | Comprobar Freighter, Supabase y Storage reales con el build final aprobado. Verificar que el informe del lote elegido incluya su referencia de transacción y permita descargar el PDF con un permiso vigente. |
| §8.D, §9 · verificación independiente, alteraciones y RPC indisponible | PASS | D3.4, 96/96 focalizadas y de regresión, commit `e77aed8d42cd9766f660f9ea384bbb87bf06c88b`. CLI sin backend en fixture y comprobación RPC real E6. |
| §8.E · checklist, procedimiento, fixture y ensayo | PASS | Este paquete y E1–E6. |
| §8.E · conformidad y alcance del acceso en el ensayo | UNVERIFIED | Se acreditó el acceso técnico al PDF privado. El expediente revisado carece de un registro separado de conformidad. El checklist indica cómo registrarla en un ensayo posterior. |
| §7, §9, §11 M2/M4 · modalidad alojada y control de claves | UNVERIFIED | D2 acredita consulta HTTPS. Las cinco operaciones de Patricia fueron en HTTPS local. El ensayo documenta cuentas distintas y operación independiente, con custodia compartida. |
| §7–9, §11 M3/M4 · entrega final | PENDING | Un tag/manifiesto final con versiones comprobadas, video, URL, logs, resultados y archivos de evidencia. |

## Pendientes para D3.6

1. Validar el recorrido real del revisor y la asociación Plant en el origen final autorizado. D3.3 toma su referencia de transacción del archivo D2 del lote #3. E6 verificó el #4 con una entrada derivada de E4. Si el #4 es el lote elegido para la aceptación alojada, queda pendiente que el informe emitido por la página entregue esa referencia y el PDF bajo el permiso correcto.
2. Consolidar el tag, manifiesto, video, URL, logs y archivo de envelopes/resultados disponibles. Vincular la evidencia de los negativos aún sin acreditar, las versiones exactas de Chrome/Varial si constan en registros, los cinco fallos de fixtures API reproducidos en el baseline y la denegación Carrier del PDF D2 por posesión faltante (HTTP 409). Dejar explícito el alcance del HTTPS local y de la custodia compartida al evaluar M2/M4.
3. Fijar fecha oficial y responsable del período de 30 días según el [plan de mantenimiento](evidence/d2-final/MAINTENANCE-30-DAYS.md). La fecha del ensayo queda como evidencia del ensayo.

Costo incremental de D3.5 **US$0**.
