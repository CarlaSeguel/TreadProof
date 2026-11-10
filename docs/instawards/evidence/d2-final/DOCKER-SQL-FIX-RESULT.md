# Cierre del parche Docker — 10 de noviembre de 2026

El parche autorizado quedó instalado en Dockerfile.d2.stellar y su dockerignore. Solo incorpora tres fuentes SQL de validación: d2-high1-high2-integrated-lab.sql, d2-high-integrated-preparation.sql y d2-high-integrated-journal.sql. Sus bytes permanecen intactos. No se ejecutaron migraciones ni se modificaron reglas SQL/RLS.

La única modificación adicional es la expectativa de backend/test/local-auth-server.test.js: company_batch3_reference_read_only=true. El contrato de server.js publica ese campo cuando recibe batch3ReferenceService; createLocalAuthServer ya compone createCompanyBatch3RlsRead. El lector exige Company/JWT/RLS y no habilita preparación, firma o despacho. El endpoint no fue modificado.

## Resultados

- Imagen reconstruida; Node 24.19.0, PostgreSQL 17.11, Stellar CLI 26.0.0, usuario 10001.
- Los tres SQL empaquetados coinciden con sus hashes y las propuestas offline Company/Carrier se construyen sin ENOENT.
- Regresión focal de runtime/Auth/SEP-53/historial: 258 PASS, 0 FAIL, 0 SKIP. Usa copias de tests y soporte existente de fixtures de solo lectura; no es la suite global del repositorio.
- Frontend real empaquetado, API y proxy: HTTP 200; cuatro assets compilados coinciden byte/hash con la imagen. Sin identidad: 401. Diez rutas NFU y la escritura de evidencia: 404. Auth/posesión/historial de este smoke son dependencias sintéticas; no acreditan sesiones reales ni TLS.
- Once casos nativos sobre la copia parcial existente PASS antes y después de reiniciar: mismos fingerprints, recibos, firmas, revisiones y CAS. Incluyen rollback de una tabla de control del laboratorio y HIGH1 de lectura de uso único. No se suman los mismos once casos dos veces.
- Ochenta fuentes backend activas coinciden con sus pins; fuera de los tres archivos autorizados se conservaron los demás hashes protegidos.
- Sin credenciales productivas, escrituras originales, nuevas intenciones/attempts reales o transacciones Stellar. Contenedores detenidos; volúmenes históricos de laboratorio conservados. Sin Render ni Git commit/tag/push.

## Bloqueo de restauración completa y arranque nativo

No existe una copia completa actual acreditada en los expedientes revisados. El inventario encontró el dump retenido anterior al cierre de las operaciones restantes y la copia parcial del ensayo anterior. Esta última contiene cinco intenciones/attempts terminales y una reconstrucción explícita de roles/ACL; no acredita todos los datos y dependencias originales.

Se detuvo la restauración completa. No se creó otro dump desde la base original ni se usaron sus credenciales. La copia parcial no se presentó como respaldo completo.

El CLI real de la imagen se probó solo contra esa copia parcial: superó la carga de SQL, pero el gate nativo rechazó su catálogo con integrated_identity_surface_open y terminó con código 1. No se cambió SQL, ACL ni el gate para forzar arranque. La validación del runtime completo sigue BLOQUEADA; el HTTP 200 sintético no la sustituye.

## Reproducción

lab-plan.json e installed.patch identifican preimágenes/postimágenes. Docker: construir desde el worktree con Dockerfile.d2.stellar y el tag del plan. Ejecutar los ocho archivos de regresión que enumera regression.tap con network=none, root filesystem de solo lectura, tmpfs /tmp y las copias de tests indicadas en result.json. Los tres SQL ya están dentro de la imagen; no se montan como parche.

packaged-http-smoke.mjs arranca el frontend real con dependencias sintéticas y no escribe. image-runtime-probe.mjs verifica assets/planes; su modo --native-copy utiliza exclusivamente el loopback de la copia parcial y conserva los rechazos nativos. El laboratorio mantiene logs, hashes e inspect de imagen. No usar estos scripts contra el entorno original.

## Pendientes mínimos para HTTPS

1. Disponer de una copia completa autorizada y actual de la información necesaria para el runtime: journal e históricos, metadatos/bindings, funciones, roles/ACL/RLS, índices y excepciones, archivos privados y su inventario de integridad. No entregar JWT, claves de wallet ni credenciales productivas al laboratorio.
2. Restaurar esa copia en destino aislado con credenciales exclusivas del laboratorio, acreditar cobertura y ejecutar arranque nativo, persistencia/reinicio/rollback completos. No corregir el original ni relajar gates.
3. Con la aceptación nativa cerrada, autorizar recursos/costos y despliegue HTTPS; comprobar TLS, mismo origen y acceso privado en destino.
4. Mantener separadas las autorizaciones de reproducción con cuentas nuevas/revisor y commit/tag/push/video/release. Ninguna se ejecutó aquí. El mantenimiento de 30 días no se declara iniciado.
