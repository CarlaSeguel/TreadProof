# Cumplimiento D2 frente al SOW v2.5

Actualización: runtime de solo lectura validado localmente y Company terminal exportado bajo JWT/RLS. Imagen Docker y publicación HTTPS continúan pendientes.

| ID / SOW | Requisito | Estado | Evidencia | Pendiente real |
|---|---|---|---|---|
| D2-01 / §7 / §6 | Cinco acciones, roles y cuatro mediciones | CUMPLIDO | manifest.json operations; evidence/cycle-closure-summary.json | No repetir operaciones #3. |
| D2-02 / §7 | Interfaz con historia, attestation, evidencia y Stellar | CUMPLIDO_LOCAL_PUBLICACION_PENDIENTE | deploy/build-d2-public.mjs; evidence/runtime-native-local.json | Publicar exactamente la imagen validada; el servicio Render existente no se modificó. |
| D2-03 / §6.6 / §7 | Separar estado local y confirmación blockchain | CUMPLIDO_LOCAL | evidence/history-presentation-tests.tap | Revisar etiquetas en build HTTPS final. |
| D2-04 / §6.4 / §7 | Recuperar bytes privados y comprobar SHA-256 antes de attestation | CUMPLIDO | evidence/valorization-terminal.json | Mantener PDF privado; no repetir registro/carga. |
| D2-05 / §7 entorno | Linux, Node.js 24 y tooling fijado | PARCIAL | RUNTIME-SOURCE-PINS.json; evidence/runtime-local-tests.tap | Docker build/run y minor de PostgreSQL/CLI reales de la imagen; daemon no disponible. |
| D2-06 / §6.3 / §7 | HTTPS y frontend/API del mismo origen mediante proxy | PARCIAL | evidence/runtime-native-local.json; evidence/runtime-local-tests.tap | Validación HTTPS en origen publicado; las pruebas ejecutadas usaron HTTP local aislado. |
| D2-07 / §7 / M2 | Cuentas nuevas, organizaciones y pertenencia explícita | PENDIENTE_EJECUCION | REPRODUCTION-RECOVERY.md | Fixture aislado y ejecución humana autorizada; preservar #3. |
| D2-08 / §7 | Comandos, entorno sin secretos y fixtures sintéticos | PREPARADO | REPRODUCTION-RECOVERY.md; deployment/runtime.env.example | Ejecutar reproducción limpia. |
| D2-09 / §7 | Manifiesto único de commit/tag/build/contratos/hashes/pruebas/video/URL | PARCIAL | manifest.json; RELEASE-PLAN.md | Commit/tag/build/image/video/URL finales; las cinco exportaciones terminales están incorporadas. |
| D2-10 / §7 / §9 | Regresión/aceptación del release con resultados reales | PARCIAL | TEST-INVENTORY.json; evidence/history-presentation-tests.tap | Suite completa del commit final; no sumar conteos históricos. |
| D2-11 / §7 | Video de demostración | GUION_PREPARADO | VIDEO-SCRIPT.md | Grabar, revisar y registrar URL/SHA-256. |
| D2-12 / §7 / M4 | Revisor distinto al operador con cuentas nuevas | PENDIENTE_EJECUCION | REPRODUCTION-RECOVERY.md | Designar revisor y autorizar corrida separada. |
| D2-13 / §7 | Acceso autorizado a evidencia privada | CUMPLIDO_LOCAL | evidence/valorization-terminal.json | Verificar JWT/RLS en origen final; no publicar bucket. |
| D2-14 / §7 | Restauración ante reset y archivo histórico | PROCEDIMIENTO_PREPARADO | REPRODUCTION-RECOVERY.md | Ensayo aislado requiere aprobación. |
| D2-15 / §7 / §10 | Disponibilidad 30 días, responsable y costo dentro de D2 | PLANIFICADO | MAINTENANCE-30-DAYS.md | Fijar fecha de entrega y registrar período real. |
| D2-16 / §3 / §7 | Finalización, crédito y badge separados | DELIMITADO | README.md; VIDEO-SCRIPT.md | No emitir crédito ni badges nuevos para cerrar D2. |
| M1-contexto / §11 M1 | Freighter, roles, negativos y SEP-53 | REGRESION_FINAL_PENDIENTE | TEST-INVENTORY.json; manifest.json compatibility | Registrar extensión y regresión final. |
| M2-contexto / §11 M2 | Demo HTTPS: cinco acciones con cuentas nuevas y persistencia | PARCIAL | HOSTING-DEPLOYMENT.md | El flujo local #3 no acredita por sí solo M2 alojado. |
| M4-compartido / §11 M4 | Revisor, reproducción limpia y release sin campos pendientes | PENDIENTE | RELEASE-PLAN.md | Cerrar gates reales antes de declarar entrega. |
| D3-limite / §8 / M3 | Review/reviewer, revocación y pilot-readiness nuevos | FUERA_DEL_ALCANCE_D2 | SOW completo §8 | Evaluar en D3; no agregar funciones aquí. |
