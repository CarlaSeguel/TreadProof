# Fase 6: backend y Supabase

Verificación final: 2026-10-03. Proyecto remoto de CarlaSeguel: `eviifvhdipdqhxzqxmbm`.

## Git y alcance

Repositorio inicializado en `main`, remoto `https://github.com/CarlaSeguel/TreadProof.git`. El remoto estaba vacío. Primer commit y push confirmados: `e9d352de5da5056a80a116e694f6923a74bb5d6e`, `feat: complete TreadProof core contracts and Testnet demo`. Autor configurado: Carla Seguel, con el correo autorizado por la usuaria.

Esta entrega corresponde al segundo commit `feat: add Supabase and backend data layer`; su SHA se obtiene con `git log -1` después del commit. No se modificaron los contratos ni sus tests. No se implementó frontend ni se enviaron nuevas transacciones Stellar.

## Archivos

- `backend/package.json`, `package-lock.json`, `README.md`: dependencias fijadas, comandos y API.
- `backend/src/{server,service,supabase,stellar,validation}.js`: HTTP, reglas de metadata, acceso con JWT/RLS, lecturas de contratos y validaciones.
- `backend/test/{api,database}.test.js`: 49 pruebas.
- `backend/scripts/verify-{stellar,supabase}.js`: comprobaciones remotas de lectura.
- `supabase/config.toml`, `.gitignore`, `README.md`: configuración y operación.
- `supabase/migrations/20261002182133_offchain_mvp.sql`: esquema, grants, RLS, triggers y Storage.
- `supabase/tests/{verify_schema,remote_rls}.sql`: verificaciones remotas; fixtures transaccionales con rollback.
- `scripts/supabase/prepare-sql-editor.ps1`: envoltorio transaccional con historial de migraciones.
- `deployments/supabase.json`: identificadores públicos del despliegue.
- `.env.example`, `README.md`: configuración sin secretos y estado del proyecto.
- `docs/architecture/offchain-architecture.md`, este reporte y `evidence/`: arquitectura y resultados. Se conservaron los logs históricos de Fase 5.

## Arquitectura y esquema

Node.js 24 sirve una API local. Valida cada JWT contra Supabase Auth y conserva ese JWT en PostgREST/Storage: no usa service role. Stellar sigue siendo la fuente de estados, masas, impacto y badges; la API consulta los contratos canónicos de `deployments/testnet.json` usando Stellar CLI con `--send no`, sin llaves privadas. Los enteros grandes permanecen como cadenas decimales.

Supabase contiene cinco tablas: `organizations`, `profiles`, `tire_batches`, `batch_evidence` y `batch_events`. Todas tienen RLS y permisos anónimos revocados. Membresías y roles requieren aprovisionamiento administrativo. Los participantes consultan sus lotes; los eventos se generan mediante triggers. El bucket `treadproof-evidence` es privado y admite archivos de hasta 5 MiB.

Los archivos se verifican mediante SHA-256 calculado sobre sus bytes. La comparación con el hash on-chain se informa por separado; no prueba por sí sola la valorización física.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Rust | 98 aprobadas: TireRegistry 40, ImpactRegistry 29, BadgeContract 29 |
| Wasm | Las mismas 98 aprobadas |
| cargo fmt / Clippy | Aprobados, sin advertencias |
| Backend | 25 pruebas API/servicios aprobadas |
| PostgreSQL/PGlite | 24 pruebas SQL/RLS aprobadas |
| npm audit | 0 vulnerabilidades detectadas |
| Stellar Testnet | Lectura real de lote demo, contratos vinculados, 4.900 TP e insignia TRACE |
| Supabase HTTP anónimo | Acceso denegado: HTTP 401, código PostgreSQL 42501 |
| RLS remoto | PASS: participantes, aislamiento, vínculos inmutables, membresías protegidas, denegación anónima; rollback de fixtures |
| Catálogo remoto | Cinco tablas con RLS y sin SELECT anónimo; bucket privado, 5.242.880 bytes |
| Security Advisor | Tras ejecutar Rerun linter: 0 errores, 0 advertencias, 0 sugerencias |

La migración fue aplicada desde SQL Editor de Carla, con versión `20261002182133` en el historial. El contenido leído desde el historial coincide con el archivo local al normalizar espacios. El MD5 sin whitespace coincide en ambos: `e794e2b938a4db60a23584b0253f0837`. El editor modifica el formato, por lo que no se afirma igualdad byte a byte.

Las pruebas locales usan stubs mínimos de los esquemas Auth/Storage sobre PostgreSQL real. La prueba remota verifica RLS con roles reales, pero no sustituye una prueba HTTP autenticada completa de carga/descarga con un usuario real.

## Seguridad y operación pendiente

`.env`, identidades Stellar, `.tools`, dependencias y binarios de compilación quedan fuera de Git. `.env.example` no contiene valores. El backend rechaza claves privilegiadas. Auditoría final: 141 archivos del proyecto y 33 archivos del índice sin patrones de secretos ni coincidencias con las tres identidades privadas locales. Se corrigió en scripts/Audit-Secrets.ps1 un falso positivo entre líneas de variables vacías; se comprobó que sigue detectando valores sensibles.

Para operar con personas reales falta crear usuarios Auth y provisionar organizaciones/perfiles con direcciones verificadas. No se enviaron invitaciones ni se dejaron usuarios de prueba. La API está implementada para ejecución local; su hosting HTTPS queda pendiente. El conector MCP actual pertenece a otra cuenta; el despliegue solicitado se completó usando la sesión autorizada de Carla.

Límites del MVP: subida de objeto y registro de evidencia no son una transacción única; un fallo deja metadata pendiente de revisión. Las lecturas de varios contratos no forman una instantánea atómica. El control de frecuencia es por proceso. Estas restricciones están documentadas en el README del backend.
