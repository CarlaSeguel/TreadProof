# Plan mínimo de release y entrega D2

## Artefactos y anclaje

El nombre instaward1-d2-sow-v2.5-rc1 es una propuesta; no existe todavía tag creado por este trabajo. El HEAD inspeccionado b128d1d69a4f1bd42954f8f08083d3bbd93f828d corresponde a documentación D1 previa, con cambios D2 aún sin commit. Los package.json siguen en 0.1.0; SOW v2.5 no es una afirmación de versión de esos paquetes.

La plantilla manifest.json mantiene null los campos no ejecutados. El manifiesto final se genera como ASSET externo al commit/imagen, después de conocer sus hashes. No intentar incluir el propio hash de commit o digest de la imagen dentro de sus bytes y luego cambiarlo: eso crea autorreferencia. El asset final enlazará commit/tag, imagen/build, pruebas, video, contratos, transacciones, URL y archivos de evidencia.

Conservar:
- Código final y diff respecto al baseline 40d0bb027d17e29af6cbb92135517ae04b237e6e.
- Manifiesto final, checksums, matriz de aceptación y log de regresión.
- IDs/WASM, actores, cinco hashes y ledgers; recibos proyectados y digests con versión exacta.
- PDF privado e índice de su archivo restringido; no hacer público el bucket.
- Video final con SHA-256, URL y duración.
- Reproducción/revisor, despliegue/rollback y registro de mantenimiento.

## Orden de ejecución

| Paso | Trabajo y gate | Intervención necesaria |
|---|---|---|
| 1 | Empaquetado/origen/vista #3 corregidos y probados en Node; construir/ejecutar la imagen aislada pendiente | Preparación técnica local; disponer del daemon Docker para probar. Sin costo, firma o despliegue automático |
| 2 | Company terminal ya incorporado; fijar versiones de imagen/extensión y cerrar regresión | Registrar versión de extensión y herramientas de imagen; no repetir la lectura ni ejecutar otro CAS |
| 3 | Revisar allowlist de archivos y secretos; crear commit final de código y pruebas | Autorización explícita de commit; no git add indiscriminado sobre el worktree |
| 4 | Construir desde ese commit, probar y fijar digest; preparar DB/secretos destino | Aprobación separada de backup/restore y costo/acceso a hosting |
| 5 | Desplegar imagen exacta, probar HTTPS/proxy/identidades/privacidad e historia | Autorización de push/deploy; sin nuevas transacciones por efecto del deployment |
| 6 | Revisor realiza reproducción limpia con cuentas nuevas; grabar video y consolidar aceptación | Aprobar fixture/provisión y transacciones separadas; firmas y envíos solo humanos |
| 7 | Generar asset final sin pendientes; crear tag y publicar release del mismo commit | Autorización explícita de tag/release y publicación; comprobar enlaces descargables |
| 8 | Acordar entrega e iniciar mantenimiento; registrar el período real | Responsable acepta fecha/accesos; cerrar mantenimiento después de 30 días acreditados |

Si una prueba requerida falla, registrar FAIL y detener el gate correspondiente. No rebautizar un conteo de pruebas focales como suite completa. Los fallos Auth de baseline se revisan contra el candidato final; no se ignoran sin resultado/plataforma/impacto documentados.

## Criterio binario de entrega

La integridad de este paquete puede pasar hoy. La aceptación final exige: commit/tag reales, build/digest vinculado, demo HTTPS actual, versiones completas, regresión y reproducción por revisor, video/URL/SHA y fecha/responsable de mantenimiento. El día de entrega no certifica que ya transcurrieron los 30 días.

tools/verify_package.py --strict-release debe rechazar el estado presente. Ningún campo pendiente se rellenará con valores inventados. Las funciones D3, un nuevo sistema de permisos, crédito de TirePoints, badges y nuevas transacciones del lote #3 quedan fuera de este plan.

## Autorizaciones separadas propuestas

Fase A: habilitar Docker y autorizar la regresión completa y restauración de una copia aislada para probar arranque/persistencia/rollback. Sin operaciones NFU reales ni cambios del original. La creación/restauración persistente del destino exige aprobación separada.

Fase B: designar revisor y autorizar provisión del fixture fresco y su reproducción manual. Wallets/firmas/envíos permanecen humanos; no es una repetición de #3.

Fase C: con digest/build y regresión acreditados, aprobar recursos/costo/acceso Render y, por separado, commit/push/tag y despliegue del candidato exacto. Ninguna de estas acciones se ejecutó ahora.
