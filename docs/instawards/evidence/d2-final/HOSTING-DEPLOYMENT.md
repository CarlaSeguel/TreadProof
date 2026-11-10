# Hosting D2 y runtime corregido localmente

## Qué se instaló y qué se probó

| Archivo | Cambio |
|---|---|
| Dockerfile.d2.stellar | Build frontend con lockfile, Node 24.19.0 por digest, dos módulos compartidos, tooling y PostgreSQL 17 sin inicialización automática |
| Dockerfile.d2.stellar.dockerignore | Contexto acotado; incluye dependencias necesarias y excluye secretos, privados, backups y diagnóstico de reloj |
| deploy/d2-runtime-entrypoint.mjs | Auth/SEP-53/historial existentes; solo HIGH1 de lectura; origen HTTPS exacto, backend loopback y perfil PostgreSQL explícito |
| deploy/d2-readonly-server.mjs | Proxy /api permitido del mismo origen; mutadores bloqueados antes del backend; cancelación/timeout sin reintento |
| deploy/build-d2-public.mjs | Empaqueta corte público #3, acceso autenticado y fixture histórico distinguido; no publica el PDF privado |
| deploy/test/d2-runtime.test.mjs | 20 pruebas del runtime y del grafo de dependencias |

Los módulos omitidos eran web/src/d2-carrier-xdr-profile.mjs y web/src/d2-company-xdr-profile.mjs. No se cambiaron esos módulos ni el núcleo NFU. RUNTIME-SOURCE-PINS.json fija los seis archivos de esta intervención.

Node base: node:24.19.0-trixie-slim@sha256:ab3eebe934147fee049b5eb83c570f68c849a13c930bdfa482de99fcdfa3b3de. Se consultó el manifiesto OCI público; no se descargó ni ejecutó la imagen. La CLI conserva la referencia fijada previa 26.0.0; la diferencia con el README que dice 28 debe quedar documentada, no resolverse actualizando contratos a ciegas.

Se probó el runtime nativo con Node 24.19.0, el catálogo existente y puertos HTTP locales aislados: páginas, status, health y proxy respondieron correctamente; /v1/me sin JWT devolvió 401 y siete rutas mutadoras devolvieron 404. No se inició/reinició PostgreSQL ni se emitieron concesiones HIGH1 en esa comprobación sin sesión. Evidencia: evidence/runtime-native-local.json.

Docker client 29.9.2 está instalado; el daemon Docker Desktop no estaba disponible. No existe todavía una imagen construida/ejecutada ni un RepoDigest final probado. Los Dockerfile.d2 y Dockerfile.d2.runtime anteriores no son los comandos del candidato actual; usar exclusivamente Dockerfile.d2.stellar.

## Composición sin nuevas operaciones

- Entrada pública: 0.0.0.0:$PORT. Backend: 127.0.0.1:3002. PostgreSQL: 127.0.0.1:55440, nunca expuesto a la red pública.
- / muestra el lote #3 con un corte fechado de verificaciones reales. No afirma hacer RPC fresco al abrir la página.
- /operator.html sirve el frontend compilado, rotulado como solo lectura. La API permite únicamente Auth, contexto, SEP-53 e historial original bajo JWT/RLS.
- El emisor solo persiste/consume concesiones técnicas read/read_journal. No se monta un writer HIGH2 ni se requiere su password. No hay ventanas NFU ni métodos prepare/simulate/sign/submit/verified accesibles.
- Las referencias históricas con origen localhost conservan ese origen como procedencia. Solo el HTTPS configurado puede solicitar nuevas lecturas públicas.
- El PDF permanece privado. Ningún diagnóstico, .env, SQL, firma, XDR o archivo privado se sirve por rutas estáticas.

## Configuración realmente consumida

deployment/runtime.env.example contiene nombres sin secretos. TREADPROOF_DEPLOYMENT_ORIGIN debe ser el origen HTTPS exacto sin slash final. El runtime aplica ese origen a trustedOrigins, emisor y dominio SEP-53; no admite sustitución desde el request.

Supabase solo recibe URL y publishable key aprobadas. Nunca service_role, JWT de participante, seed o llave privada en env/repo/build. Los archivos montados en runtime son:
- /etc/secrets/treadproof_pgpass → /home/carla/.pgpass: login restringido de catálogo/journal.
- /etc/secrets/treadproof_high1_pgpass → /home/carla/.treadproof-high1-issuer.pgpass: emisor de concesiones read.

El runtime copia únicamente si el archivo destino no existe, valida propietario/permisos 0400/0600 y no imprime su contenido. UID del usuario de contenedor: 10001. No se suministraron credenciales reales a este empaquetado.

TP_D2_POSTGRES_MODE=existing-loopback no reinicia DB y requiere una instancia ya preparada. restored-local solo arranca PG17 desde TP_D2_PGDATA con PG_VERSION=17 y socket/puerto privados; no ejecuta initdb, restore, migraciones, roles ni reparaciones. La creación/restauración de la copia destino debe autorizarse y realizarse antes, fuera del arranque automático. El original no se sobrescribe.

## Propuesta Render y costo desglosado

Reutilizar el servicio treadproof-d2-demo y https://treadproof-d2-demo.onrender.com/. El 10/11/2026 raíz, status y runtime-health respondieron 200, pero el despliegue anterior todavía declara synthetic_read_only/verifiedOnStellar=false. No se ha publicado este runtime.

| Recurso propuesto | Referencia mensual USD | Condición |
|---|---:|---|
| Render 1c-2g, 1 CPU / 2 GB RAM | 25,00 | Una instancia paga; aprobación de facturación pendiente |
| Disco persistente 1 GB | 0,25 | USD 0,25/GB-mes; confirmar tras restauración y prueba |
| Subdominio onrender.com y TLS administrado | Sin dominio adicional | Reutilizar el existente |
| PostgreSQL 17 co-localizado | Sin otro servicio de cómputo propuesto | Usa recursos/disco anteriores; no DB remota incompatible con las guardas |
| Supabase Auth/Storage existentes | Sin ampliación contratada | Revisar plan/cupos del titular; no asumir costo cero de su cuenta |
| Registro de imagen, extras, impuestos | Por confirmar | No incluidos en la suma de referencia |

Referencia de compute+disco: USD 25,25/mes, no una factura ni gasto autorizado. La DB actual mide 8.844.979 bytes; esto no mide el cluster completo/WAL/backups ni garantiza el espacio del destino. Confirmar ocupación y margen después de restaurar. No guardar el único backup en el mismo volumen.

Tarifas consultadas el 10/11/2026: https://render.com/pricing y https://render.com/docs/compute-plans. Discos y pausas de redeploy: https://render.com/docs/disks. El plan Free es efímero y duerme tras inactividad: https://render.com/docs/free. Todo hosting/30 días está dentro de los USD 2.100 asignados a D2.

## Gates para liberar el despliegue

1. Activar Docker y construir/ejecutar localmente esta imagen; comprobar Node, CLI, minor PG17, módulos nativos y arranque con la configuración exacta.
2. Autorizar restauración en destino aislado y ensayar persistencia/rollback; preservar catálogo, ACL, FORCE RLS, UNIQUE/CAS y exclusiones auditadas. Sin modificaciones del original.
3. Ejecutar regresión completa del candidato. La reproducción con cuentas nuevas es otra fase y exige autorización e intervención humana.
4. Confirmar control de cuenta/servicio Render, región, límites y costo. No comprar dominio ni exponer PostgreSQL.
5. Autorizar commit/push/tag y publicación de imagen/build exactos. Registrar RepoDigest y buildId, no confundir image ID local con digest del registro.
6. Autorizar desplegar ese candidato, con autoDeploy desactivado; comprobar HTTPS real, mismo origen, Auth/SEP-53, privacidad, historia y recuperación.
7. Completar video/revisor/release y fijar fecha oficial; iniciar mantenimiento, sin declararlo ya cumplido.

Comandos propuestos, todavía no ejecutados, desde un checkout final autorizado:

```sh
docker build --platform linux/amd64 --file Dockerfile.d2.stellar --tag treadproof-d2-candidate:<codeCommit> .
docker image inspect treadproof-d2-candidate:<codeCommit>
```

No subir ni desplegar hasta probar la imagen. Render admite imagen preconstruida por referencia inmutable: https://render.com/docs/docker. La cuenta, registro y secretos se gestionan por el titular, sin copiarlos al chat.
