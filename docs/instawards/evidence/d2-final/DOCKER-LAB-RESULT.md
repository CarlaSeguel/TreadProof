# Ensayo Docker D2 — 10 de noviembre de 2026

La imagen exacta preparada se construyó y ejecutó. El despliegue sigue bloqueado: el control de arranque requiere tres archivos SQL que Dockerfile.d2.stellar no copia. No se modificó el runtime candidato. La propuesta de dos archivos de empaquetado está en evidence/docker-lab/PACKAGING-SQL.proposed.patch; copia fuentes de validación, no ejecuta migraciones.

Resultados acreditados:

- Node 24.19.0, PostgreSQL 17.11, Stellar CLI 26.0.0; usuario 10001. Ochenta fuentes backend activas coinciden con sus pins.
- Runtime público: 20 PASS. Auth/SEP-53: 180 PASS; dos suites de fixtures no cargan en la imagen por nfu-xdr-budget.mjs. Con una copia de solo lectura de ese soporte: 57 PASS y 1 FAIL por expectativa antigua de health (capacidad adicional de solo lectura). Estos resultados no equivalen a una regresión completa PASS.
- Once casos nativos PASS; repetidos tras reinicio y restauración sin sumar tres veces los mismos casos. Las diez filas terminales conservan recibos, firmas, revisiones y CAS. Fingerprints de filas y catálogo iguales antes/después. Rollback limitado a una tabla de control del laboratorio.
- PDF recuperado: 76.314 bytes idénticos; SHA-256 028a738e3b060c4d78f2b60cd4a966830064090140a873f2a36565ef41a9228d.
- Contenedores sin salida de red, sin puertos publicados ni secretos originales. La única red compartida apuntó al loopback de otro contenedor network=none. Los contenedores quedaron detenidos y se conservaron volúmenes y backups.

## Alcance de restauración

Se reconstruyó un subconjunto independiente a partir de exportaciones autenticadas ya conservadas: cinco intenciones y cinco attempts confirmados, esquema archivado, cuerpo run e índice actuales y PDF. Roles/ACL se reconstruyeron expresamente para el laboratorio. No es un dump completo del cluster original ni una restauración de Supabase Auth/Storage. La igualdad de catálogo acredita las dos copias del laboratorio, no equivalencia completa con producción. Un ensayo con los SQL propuestos alcanzó el gate nativo, que rechazó el catálogo parcial por integrated_identity_surface_open; no se relajó el gate.

## Reproducción local

El directorio de laboratorio conserva lab-plan.json, docker-build.log, scripts y backups privados; su ruta aparece en el informe de cierre. Construcción: docker build --progress=plain -f Dockerfile.d2.stellar -t <tag-del-plan> . desde el worktree con los pins acreditados. Las pruebas usan copias de tests y mounts de solo lectura, network=none y volúmenes exclusivos por ejecución. No apuntar los scripts a la base original.

1. Inicializar un cluster vacío solo en el volumen de laboratorio, usuario 10001; arrancarlo mediante pg-hold.mjs. El initdb es una acción explícita del ensayo, nunca del arranque de la aplicación.
2. Crear la DB del plan dentro del contenedor, cargar seed-copy.private.sql y ejecutar native-copy-test.mjs. Las lecturas HIGH1 usan roles de aplicación no superusuario; el administrador se usa solo para preparar/restaurar la copia.
3. Reiniciar un contenedor cuyo comando sea únicamente pg-hold.mjs; esperar pg_isready. Comparar fingerprint y PDF. No reutilizar el comando inicial initdb al reiniciar.
4. Respaldar con pg_dump -Fc y listar con pg_restore --list. En un segundo volumen/cluster vacío, cargar backups/lab-roles.sql, crear la DB y ejecutar pg_restore --exit-on-error. No iniciar esa restauración sobre un destino con datos.
5. Ejecutar de nuevo los once casos y catalog-fingerprint.sql; comparar bytes del PDF y detener ambos clusters. Los roles son fixtures sin credenciales productivas; trust se limita a loopback dentro de network=none y no constituye validación de autenticación PostgreSQL productiva.

## Gates pendientes para HTTPS

1. Autorizar/aplicar exclusivamente el parche de empaquetado preparado y corregir la expectativa de health demostrada; reconstruir y cerrar la regresión.
2. Preparar un respaldo completo y destino de restauración con sus roles/ACL y secretos de lectura separados; validar arranque real y Auth/SEP-53/historial. No usar credenciales administrativas como identidad de participantes.
3. Autorizar separadamente la reproducción con cuentas nuevas y revisor; no repetir #3.
4. Aprobar recursos/costos y despliegue Render; validar TLS, mismo origen, persistencia y acceso privado en ese entorno. Fijar commit/tag/build, video y URL bajo autorización específica. Mantenimiento de 30 días todavía no iniciado.

Cero transacciones Stellar, nuevas intenciones/attempts reales o escrituras al entorno original. No hubo commits, tags, push, despliegues ni gastos.
