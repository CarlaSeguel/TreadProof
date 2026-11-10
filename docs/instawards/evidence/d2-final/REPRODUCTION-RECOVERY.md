# Reproducción, restauración y reset Testnet

## Verificación del lote #3 sin escribir

Este expediente corresponde al lote Testnet 3, UUID c7aba1fd-1991-40b5-9e63-d42ab439f867, final Valorized. Las cinco referencias no deben reutilizarse como operaciones.

1. Verificar checksums y coherencia del paquete con tools/verify_package.py.
2. Abrir las cinco URLs Horizon del manifiesto; comparar hash, successful, ledger, cuenta y secuencia. Para lectura de estado, reutilizar createTestnetReadOnlyRpc.readBatch y createStellarTestnetReader con el manifiesto de contratos aprobado.
3. Comparar actores y masas 1000/950/925/900 g; evidencia_hash debe coincidir con manifest.json evidence.sha256.
4. Obtener el PDF privado únicamente por la sesión Plant autorizada. Comparar sus 76.314 bytes y SHA-256 con el original; no registrar ni subir otra evidencia.
5. Para PostgreSQL, usar el lector HIGH1 read/find de la identidad original, con JWT/RLS y SEP-53; no SQL administrativo para sustituirla. Consultar historial completo, revisiones, recibo, digest y despacho. La lectura de historial por sí sola muestra un corte LOCAL, no RPC fresco.
6. La exportación terminal Company ya está incorporada: confirmed, revisiones 5/4, ledger 5589704 y digest persistido coincidente. Consultar evidence/company-terminal.json; no ejecutar otro CAS ni alterar una operación cerrada.

Las respuestas RPC se conservan con oldestLedger/latestLedger. Tras salir de retención, NOT_FOUND no invalida por sí solo una confirmación archivada ni demuestra que no se transmitió. Mostrar el corte fechado y sus recibos; no rotularlo como lectura actual de un contrato desaparecido.

## Checkout y pruebas limpios

Solo después de fijar y autorizar el commit de release: clonar en directorio aislado, registrar commit y verificar lockfiles. Node soportado >=24 <25; fijar el patch exacto validado en el manifiesto final. Comandos desde raíz, sin ejecutar scripts de demo:

```sh
node --version
npm --prefix backend ci --ignore-scripts
npm --prefix web ci --ignore-scripts
npm --prefix backend test
npm --prefix web test
npm --prefix web run build
python3 docs/instawards/evidence/d2-final/tools/verify_package.py
```

Los tests nativos requieren PostgreSQL 17 en laboratorio separado y el runtime aprobado para ese entorno. No apuntar la suite a la DB del lote #3. Registrar PASS/FAIL/SKIP, plataforma y release; un test omitido no pasa. Revisar los cinco fallos Auth de baseline mencionados en evidencia histórica mediante la corrida final, sin asumir que persisten o que quedaron resueltos.

Las fixtures de backend/test/fixtures/nfu-lifecycle.mjs y nfu-live-fixture.mjs permiten probar end-to-end sintético sin transacciones. No sustituyen la aceptación humana con cuentas frescas y HTTPS.

## Reproducción por revisor con cuentas nuevas

Debe efectuarse en un fixture nuevo y explícitamente autorizado, distinto de #3. El operador configura usuarios sintéticos, profiles, organizaciones y sus tres wallets originales del nuevo fixture según el mecanismo existente; no permitir que el usuario se autoasigne rol/dirección. Registrar usuario→organización→rol→G-address sin tokens o seeds.

Las guardas actuales son de perfiles exactos ligados a #3: una cuenta nueva no hereda sus permisos. Preparar una configuración de fixture aislada, con evidencia/UUID/actores propios y límites validados, sin ampliar las autorizaciones vigentes ni modificar los actores #3. Provisionar cuentas/organizaciones o restaurar datos exige autorización separada. Friendbot puede financiar cuentas Testnet frescas, bajo la ejecución humana autorizada.

Un revisor distinto al operador realiza manualmente en HTTPS: create_batch 1000 g → confirm_pickup 950 g → start_transit → confirm_reception 925 g → confirm_valorization 900 g. Wallets separadas, verificar SEP-53, revisión de parámetros/comisión, Freighter manual y envío único. Cerrar cada mismo hash con HIGH2 antes de pasar al siguiente estado. Emitir ventanas individuales solo tras sus preflights y autorización.

Ante pending/unknown o timeout: detener reenvíos; consultar el mismo hash y los lectores existentes. Nunca clonar intenciones para solucionar incertidumbre. La ejecución queda pendiente; esta preparación no autoriza esas transacciones.

## Scripts históricos que no se deben usar para repetir #3

scripts/testnet/demo.ps1 crea otro lote, ejecuta también credit_batch/check_and_unlock y modifica manifests históricos. scripts/testnet/verify.ps1 espera masas de 5.000.000/4.980.000/4.950.000/4.900.000 g y el fixture anterior. No son el comando de reproducción D2 #3 ni un read-only checker apropiado para estos parámetros. Se conservan como evidencia histórica; no ejecutarlos ni sobrescribirlos.

## Reinicio de servicios sin reset de Testnet

Comprobar primero requests y operaciones activas. Ante una operación incierta, solo lecturas. Reiniciar el contenedor probado con los mismos volúmenes y secretos; arrancar sin ventanas NFU. Verificar health y origen, comparar PostgreSQL, UNIQUE y referencias confirmadas. Nunca reabrir una ventana o reenviar un signed/unknown como efecto del reinicio.

## Restauración de respaldo

Preparar por separado una copia del código/imagen fijados, catálogos, journal/intents/attempts, metadatos/bindings, índice y sus excepciones, evidencia privada y su inventario SHA-256. Separar credenciales y proteger backups. El manifiesto público no contiene el backup ni concede acceso.

Un dump puede inspeccionarse con pg_restore --list antes de cualquier escritura. La exportación privilegiada y restauración en una DB de destino aislada requieren autorización específica; no restaurar sobre el original. Verificar versiones, propietarios/ACL/FORCE RLS, tuplas históricas, recibos/digests y archivos recuperados. Probar el arranque sin operaciones habilitadas y documentar divergencias; no corregir filas para forzar coincidencias.

## Reset de Stellar Testnet o estado archivado

1. Registrar fecha y evidencia de reset/ausencia de contrato; comprobar red y retención antes de concluir.
2. Congelar y conservar íntegro este manifiesto, firmas/recibos privados y las filas confirmadas. Sus ledgers corresponden a la red histórica, no a la instancia posterior.
3. Mostrar «histórico confirmado, verificado el [fecha]; no revalidable en la Testnet actual» donde corresponda. No cambiar confirmed a otro estado para acomodar el reset ni inventar nuevos hashes para #3.
4. Recrear contratos, cuentas y fixture solo con autorización separada, usando scripts existentes revisados en un entorno nuevo. Registrar nuevos IDs, WASM, red, hashes y un manifiesto distinto.
5. Preservar el enlace a la entrega original, registrar el incidente y la recuperación y volver a comprobar la demo. Este documento no afirma que se haya ensayado o ejecutado esa recreación.

## Runtime corregido y ensayo pendiente

Dockerfile.d2.stellar es el único empaquetado candidato actual. El build público excluye el PDF y diagnósticos, y el backend solo compone Auth/SEP-53/historial. TP_D2_POSTGRES_MODE=restored-local exige un cluster restaurado explícitamente con PG_VERSION=17; no lo inicializa ni migra. El ensayo de bootstrap/restauración se realizará en un destino aislado solo con aprobación separada. El arranque local ya probado usó la DB existente y no la reinició. Docker, HTTPS real y reproducción por revisor siguen pendientes.
