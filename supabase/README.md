# Supabase — metadata de TreadProof

Proyecto remoto autorizado: **eviifvhdipdqhxzqxmbm**, cuenta/organización CarlaSeguel. Migración `20261002182133_offchain_mvp.sql`, generada mediante Supabase CLI 2.119.0. No se modificaron los otros proyectos disponibles en el conector.

## Modelo

| Tabla | Propósito y relaciones |
| --- | --- |
| organizations | Directorio aprobado: nombre, tipo company/carrier/plant y dirección Stellar única. |
| profiles | Un usuario Auth pertenece a una organización. Membresía provisionada por operador. |
| tire_batches | Etiqueta externa única, ID on-chain como texto u64, red/contrato y tres organizaciones de roles correctos mediante FK compuesta. |
| batch_evidence | Archivo por lote: ruta inmutable, SHA-256, nombre, MIME, tamaño, creador. |
| batch_events | Historial de aplicación generado por triggers: metadata_created/evidence_registered. |

No hay columnas de estado blockchain, masas valorizadas, TP ni badges. Los vínculos off-chain se cotejan con Stellar al leerlos como verificados. No se utiliza JSON libre para datos canónicos. Las referencias de evidencia se normalizan en batch_evidence, sin duplicarlas en tire_batches. Los IDs grandes se conservan como cadenas decimales.

## Seguridad

RLS habilitada en las cinco tablas. Se revocan permisos anónimos y solo se conceden las operaciones necesarias a authenticated. Los participantes ven sus lotes, archivos y eventos; la empresa crea su metadata. Los clientes no pueden editar actores/vínculos, otorgarse organizaciones, crear roles ni falsificar eventos. Un usuario solo puede cambiar su propio display_name.

El directorio mínimo de organizaciones es visible para usuarios con perfil, a fin de seleccionar participantes; no está disponible a usuarios anónimos ni contiene datos de contacto. Los perfiles solo son visibles a su titular. No se usa user_metadata como autorización.

Bucket **treadproof-evidence** privado, máximo 5 MiB, PDF/PNG/JPEG/texto. Las políticas de Storage requieren una referencia visible y que el creador coincida al subir. No hay update/delete de clientes ni sobrescritura de archivos. El backend comprueba bytes y SHA-256 al recuperar el documento; la coincidencia con evidencia on-chain se informa por separado.

La función de trigger con SECURITY DEFINER está en un esquema privado, tiene search_path fijo, comprueba auth.uid, no contiene SQL dinámico y no puede invocarse como RPC público. Los eventos se escriben atómicamente con la metadata.

## Aplicar y reproducir

Desde la raíz, instalar dependencias y usar el CLI fijado:

```powershell
npm --prefix backend ci --ignore-scripts
./backend/node_modules/.bin/supabase.cmd --version
./backend/node_modules/.bin/supabase.cmd login
./backend/node_modules/.bin/supabase.cmd link --project-ref eviifvhdipdqhxzqxmbm
./backend/node_modules/.bin/supabase.cmd db push --linked --dry-run
./backend/node_modules/.bin/supabase.cmd db push --linked
./backend/node_modules/.bin/supabase.cmd migration list --linked
```

El login/link requiere autorización de Carla y credenciales de base de datos si el CLI las solicita. No pasar secretos en argumentos que se registren. Usar el mecanismo interactivo o variables de entorno locales ignoradas. Consultar `--help` para otros sistemas operativos; el sufijo `.cmd` corresponde a Windows.

En esta entrega se usó el **SQL Editor autenticado de Carla**, porque el conector MCP pertenece a otra cuenta. La misma migración local se envolvió en una transacción junto con el registro de versión/nombre/SQL en supabase_migrations.schema_migrations. El historial está protegido y no expuesto a usuarios. Puede reproducirse el envoltorio con:

```powershell
./scripts/supabase/prepare-sql-editor.ps1
```

El resultado queda en `.tools/20261002182133_offchain_mvp.sql`. Ejecutar una sola vez en el SQL Editor del proyecto correcto. No repetir versiones aplicadas: la clave primaria y la transacción rechazan duplicados sin reejecutar parcialmente el esquema. El script no sustituye migraciones por cambios manuales; conserva exactamente el SQL versionado y el historial reconocido por CLI.

## Verificar

```powershell
npm --prefix backend test
```

49 pruebas Node: 25 de API/servicios y 24 de PostgreSQL/RLS con PGlite. Las pruebas locales crean stubs mínimos de auth/storage alrededor de un motor PostgreSQL real; no sustituyen una prueba completa de Supabase Auth/Storage HTTP.

En SQL Editor ejecutar `supabase/tests/verify_schema.sql` y `supabase/tests/remote_rls.sql`. La segunda usa transacciones con usuarios/organizaciones sintéticos y ROLLBACK; verificó permisos con los roles reales del proyecto sin dejar usuarios de prueba. Resultado remoto: PASS para company/carrier/plant, separación, inmutabilidad, membresías y denegación anónima.

## Variables y pendientes operativos

`.env.example` contiene nombres sin valores. Runtime requiere `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y Stellar CLI. La clave publishable no autoriza acceso por sí sola: cada petición necesita el JWT de un usuario real sujeto a RLS. El backend rechaza service role/secret keys. Las variables de CLI `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` y `SUPABASE_PROJECT_REF` solo sirven para operaciones administrativas; nunca pasan al frontend.

Falta dar de alta usuarios reales con Supabase Auth y asignar sus perfiles a organizaciones verificadas. Se requiere un procedimiento de validación de roles y direcciones: no existe autoasignación pública. Insertar organizaciones y perfiles mediante una sesión administrativa, usando el UUID real del usuario Auth. Nunca guardar contraseñas en SQL versionado ni sembrar credenciales compartidas. No se enviaron invitaciones por email ni se crearon usuarios persistentes en esta fase.

La API está lista para ejecución local, no desplegada en un servicio de hosting. El conector MCP actual no tiene permisos sobre el proyecto de Carla; para futuras operaciones por conector debe autenticarse con una cuenta autorizada. El SQL Editor de Carla sí se utilizó y las migraciones remotas están verificadas.
