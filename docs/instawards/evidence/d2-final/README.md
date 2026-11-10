# TreadProof D2 del primer InstaWard

El ciclo NFU sintético del lote #3 está cerrado mediante cinco transacciones reales de Stellar Testnet. Las cinco exportaciones terminales persistidas, recibos y digests están incorporados y contrastados con RPC. La entrega D2 todavía requiere imagen Docker validada, publicación del build actual, reproducción de aceptación, video y release.

| Acción | Masa g | Ledger SUCCESS | Revisión intención / attempt |
|---|---:|---:|---|
| create_batch | 1000 | 5589704 | 5 / 4 |
| confirm_pickup | 950 | 5645267 | 6 / 5 |
| start_transit | — | 5648484 | 4 / 3 |
| confirm_reception | 925 | 5649550 | 4 / 3 |
| confirm_valorization | 900 | 5651173 | 4 / 3 |

[Manifiesto](manifest.json) contiene referencias completas, actores, masas, secuencias, recibos proyectados y digests versionados. [Matriz SOW](SOW-COMPLIANCE.md) separa cumplimiento, preparación y ejecución pendiente.

El PDF sintético de 76.314 bytes tiene evidenceId 0faee5e8-9543-42c3-a9ca-c8d4380ed30b y SHA-256 028a738e3b060c4d78f2b60cd4a966830064090140a873f2a36565ef41a9228d. Plant autorizó confirm_valorization y el contrato conserva ese digest. El PDF y sus bytes siguen privados; este paquete no los redistribuye.

## Runtime actual y límites de las pruebas

El empaquetado incluye los dos módulos antes omitidos, Node 24.19.0 fijado por digest, lockfiles y la CLI fijada existente. La composición pública muestra el corte verificado #3 y ofrece acceso autenticado de solo lectura con el mismo origen y proxy. Las rutas de preparación, simulación, firma, envío, Storage y escritura terminal están bloqueadas.

Se ejecutaron 20 pruebas del runtime, 54 regresiones existentes de SEP-53/historial, 28 comprobaciones del lector Company y un arranque nativo con health/proxy/rutas bloqueadas. El arranque usó Node en WSL y puertos HTTP locales aislados, no una imagen Docker ni HTTPS publicado. El frontend actual compiló. Docker Desktop no tenía daemon disponible.

La URL Render anterior responde HTTPS 200, pero no se ha actualizado: su fixture histórico no representa el lote #3. Fechas de entrega y del período efectivo de 30 días, video, commit/tag y digest de la imagen final permanecen pendientes.

## Documentos de entrega

- [Hosting y costos](HOSTING-DEPLOYMENT.md).
- [Reproducción y restauración](REPRODUCTION-RECOVERY.md).
- [Mantenimiento 30 días](MAINTENANCE-30-DAYS.md).
- [Guion de video](VIDEO-SCRIPT.md).
- [Release y autorizaciones por fase](RELEASE-PLAN.md).
- TEST-INVENTORY.json y los logs conservan los resultados reales; no sumar conteos históricos como una sola suite final.

## Verificación local

Desde la raíz del repositorio, con Python 3:

```sh
python3 docs/instawards/evidence/d2-final/tools/verify_package.py
python3 docs/instawards/evidence/d2-final/tools/verify_package.py --strict-release
```

El primer comando comprueba integridad/coherencia. El segundo debe fallar mientras falten los gates finales. Checksums internos no son por sí solos una firma de autenticidad; el release/tag y su digest se fijarán después.

El validador estructural existente conserva mode=synthetic y onchainConfirmed=false en el recibo interno, incluso para datos RPC reales. Esos campos históricos no se editan. Las proyecciones enlazan por separado la prueba independiente SUCCESS/ledger/hash y la verificación criptográfica. No inferir confirmación por un modo interno o por una etiqueta LOCAL.

Los XDR, firmas y recibos originales permanecen en el archivo restringido del operador, identificados por SHA-256 en PRIVATE-EVIDENCE-INDEX.json. No se repiten operaciones #3 ni se requieren nuevas funciones D3, crédito de TirePoints o emisión de badges para cerrar este D2.


Actualización 2026-11-10: Docker ya fue construido/ejecutado; el arranque sigue bloqueado por SQL omitidos. Ensayo de restauración parcial aislada PASS; regresión con un fallo de expectativa. Consultar DOCKER-LAB-RESULT.md y evidence/docker-lab/result.json antes de autorizar despliegue.


Actualización de cierre Docker: parche SQL y expectativa health instalados; regresión focal 258 PASS/0 FAIL. Restauración completa y arranque nativo siguen bloqueados por falta de copia completa actual autorizada. Ver DOCKER-SQL-FIX-RESULT.md y evidence/docker-sql-fix/result.json.


Actualización: la ACL aislada fue recuperada; gate y arranque nativo PASS; recuperación del conjunto D2 declarado PASS. Ya no se exige clúster histórico completo. Ver BOUNDED-RECOVERY-RESULT.md. Proveedor real/HTTPS/lectura privada y aceptación viva siguen pendientes.
