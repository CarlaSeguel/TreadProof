# Gates exactos antes de desplegar D2

Estado: runtime y exportación Company validados localmente; Docker/aceptación publicada pendientes. No hay autorización de despliegue ni nuevas transacciones.

| Gate | Estado actual | Evidencia / acción siguiente |
|---|---|---|
| Módulos backend compartidos | Corregido | COPY de d2-carrier-xdr-profile.mjs y d2-company-xdr-profile.mjs; grafo verificado |
| Auth/SEP-53/historial y proxy mismo origen | PASS local | 20 pruebas; arranque Node nativo y health; ningún mutador accesible |
| Núcleo de identidad, SEP-53 y journal | PASS focal | 54 regresiones existentes; no sustituye suite completa |
| Company terminal | PASS | Lectura Company/JWT/RLS/HIGH1; confirmed5/4; ledger5589704, recibo/digest RPC coincidentes |
| Lector exacto Company | PASS | 28 pruebas; tupla original únicamente; batchId=null y kind intent tratados correctamente |
| Compilación frontend y snapshot público #3 | PASS | Vite y empaquetado aislados; cinco estados terminales exportados, documento privado excluido |
| Node base | Digest OCI acreditado | Referencia 24.19.0 fijada; metadatos de registro, no prueba de ejecución de imagen |
| Docker build/run | BLOQUEADO | Daemon Docker Desktop no disponible; no hay imagen ejecutada |
| PostgreSQL/restauración de imagen | Pendiente en entorno aislado | Validar minor, volúmenes, UID10001, dos secretos read-only, arranque/rollback; no inicialización ni migración automática |
| Regresión completa del candidato | Pendiente | Ejecutar contra imagen/commit exactos y laboratorio separado; clasificar fallos reales y plataforma |
| Cuentas nuevas / revisor | No autorizada ni ejecutada | Fixture nuevo, configuración y permisos específicos; firmas/envíos humanos, nunca repetir #3 |
| HTTPS/origen publicado | No actualizado | Render existente conserva fixture anterior; autorizar despliegue y comprobar origen/privacidad/versión |
| Versiones finales | Parcial | Registrar CLI/PG de imagen y extensión Freighter; no inventar ni actualizar contratos |
| Video, commit/tag/release y mantenimiento | Preparados, no ejecutados | Autorizaciones separadas; fecha de entrega e inicio real de 30 días pendientes |

## Próxima fase propuesta, sin ejecución

Primero disponer del daemon Docker. Propuesta de autorización A: construir/ejecutar la imagen y realizar regresión/restauración de una copia en un volumen aislado llamado treadproof_d2_release_validation, con DB treadproof_d2_high_integrated y puerto55440 únicamente dentro de la red del contenedor. No enlazar el PGDATA original, no publicar55440 y no modificar la instancia WSL actual. Este ensayo puede crear/restaurar datos persistentes del laboratorio y requiere autorización separada.

La autorización A no incluye cuentas nuevas, ventanas NFU, firmas/envíos, gastos, Git push/tag ni Render. Después se solicitarán separadamente B (fixture/revisor y reproducción manual) y C (recursos/costo, commit/publicación y despliegue de un candidato con digest exacto).

## Archivos de intervención revisables

Dockerfile.d2.stellar; Dockerfile.d2.stellar.dockerignore; deploy/d2-runtime-entrypoint.mjs; deploy/d2-readonly-server.mjs; deploy/build-d2-public.mjs; deploy/test/d2-runtime.test.mjs. RUNTIME-SOURCE-PINS.json conserva sus SHA-256. No se alteraron los módulos backend/web de las operaciones confirmadas.


Actualización 2026-11-10: Docker ya fue construido/ejecutado; el arranque sigue bloqueado por SQL omitidos. Ensayo de restauración parcial aislada PASS; regresión con un fallo de expectativa. Consultar DOCKER-LAB-RESULT.md y evidence/docker-lab/result.json antes de autorizar despliegue.


Actualización de cierre Docker: parche SQL y expectativa health instalados; regresión focal 258 PASS/0 FAIL. Restauración completa y arranque nativo siguen bloqueados por falta de copia completa actual autorizada. Ver DOCKER-SQL-FIX-RESULT.md y evidence/docker-sql-fix/result.json.


Actualización: la ACL aislada fue recuperada; gate y arranque nativo PASS; recuperación del conjunto D2 declarado PASS. Ya no se exige clúster histórico completo. Ver BOUNDED-RECOVERY-RESULT.md. Proveedor real/HTTPS/lectura privada y aceptación viva siguen pendientes.
