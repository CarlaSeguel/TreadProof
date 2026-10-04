# Backend TreadProof — Fase 6

API Node.js 24 (JavaScript ESM) sin frontend. Utiliza Supabase Auth/PostgREST/Storage por HTTPS y un adaptador de lectura de Stellar CLI 28.0.0. No firma ni envía transacciones. Dependencias fijadas y lockfile; `lossless-json` conserva los enteros on-chain como cadenas decimales.

## Ejecutar

Desde la raíz del proyecto, copiar `.env.example` a `.env` y configurar `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y, si Stellar CLI no está en PATH, `STELLAR_CLI_PATH`. Usar únicamente la clave **publishable**; no se requiere ni se acepta service role.

```powershell
npm --prefix backend ci --ignore-scripts
npm --prefix backend test
npm --prefix backend start
# Solo lecturas del DEMO actual en Stellar Testnet:
npm --prefix backend run test:stellar
```

La API escucha por defecto en `127.0.0.1:3001`. `PORT` y `HOST` son opcionales. Antes de exponerla fuera del equipo, configurar terminación HTTPS y controles de acceso en el proxy. El límite de 60 solicitudes/minuto por IP y 8 operaciones concurrentes es local al proceso; un despliegue distribuido requiere límite compartido. No confiar en X-Forwarded-For de clientes.

## Autenticación y rutas

Todas las rutas `/v1/` requieren `Authorization: Bearer <access_token>` de un usuario Supabase real, no anónimo, con perfil provisionado. El backend valida el token consultando `/auth/v1/user` y propaga ese mismo JWT a PostgREST y Storage, conservando RLS. No usa cookies ni CORS; se rechazan solicitudes de navegador con Origin hasta definir el frontend.

| Método/ruta | Función |
| --- | --- |
| GET /health | Salud del proceso; no garantiza disponibilidad de servicios externos. |
| GET /v1/organizations | Directorio mínimo para usuarios inscritos, hasta 100 filas. |
| POST /v1/batches | Crea metadata tras consultar el lote y verificar actores/empresa. |
| GET /v1/batches?limit=25&offset=0 | Lista solo metadata visible por RLS; no es estado blockchain. |
| GET /v1/batches/:uuid | Metadata + lectura actual de TireRegistry y cotejo de actores. |
| GET /v1/batches/:uuid/recognition | Impacto, TP, acreditación y badges consultados directamente. |
| POST /v1/batches/:uuid/evidence | Registra y sube evidencia inmutable, máximo 5 MiB. |
| GET /v1/batches/:uuid/evidence | Referencias de evidencia, hasta 100. |
| GET /v1/batches/:uuid/events | Eventos de aplicación, hasta 100. |
| GET /v1/evidence/:uuid | Recupera bytes/base64, comprueba SHA-256 y compara con hash on-chain. |

Ejemplo de cuerpo para crear metadata (sustituir UUID por organizaciones provisionadas):

```json
{
  "onchain_batch_id": "1",
  "external_batch_code": "TP-DEMO-0001",
  "company_organization_id": "<uuid-company>",
  "carrier_organization_id": "<uuid-carrier>",
  "plant_organization_id": "<uuid-plant>"
}
```

Evidencia acepta exactamente `evidence_type` (pickup/reception/valorization/other), `file_name`, `content_type` (PDF/PNG/JPEG/texto UTF-8) y `content_base64`. El servidor calcula el hash; rechaza campos adicionales como estado, masa, TP, badge, ruta o hash manual. Los IDs u64 se envían como cadenas, nunca floats ni números JS potencialmente redondeados.

## Integración y límites

`src/stellar.js` lee `deployments/testnet.json`, fija RPC/frase Testnet, permite solo getters y usa `execFile` sin shell, `--send no`, public key de simulación, timeout y límite de salida. No necesita las identidades privadas del demo. Las respuestas on-chain indican contrato y momento de consulta. Las consultas múltiples pueden observar ledgers distintos; no se promete una instantánea atómica.

`src/supabase.js` concentra el acceso HTTP con JWT del usuario y errores sanitizados. `src/service.js` verifica permisos y asociación con los actores canónicos. Un usuario que inserte metadata directamente vía Supabase no convierte esa asociación en verificada: el backend la reconcilia en cada lectura. Si Stellar falla, no presenta metadata como estado verificado.

Los eventos metadata_created/evidence_registered son generados por triggers y nunca simulan eventos blockchain. Registrar metadata de evidencia y subir bytes son dos operaciones: una subida fallida puede dejar un registro sin objeto. Su descarga falla y no se presenta como evidencia verificada; un operador debe revisar ese caso antes de volver a registrar. No hay reemplazo ni borrado de archivos por clientes.

Validar un hash solo prueba coincidencia de bytes. `matches_onchain_hash` se informa por separado y no acredita tratamiento físico. No hay caché de estado canónico, indexador, credenciales de firma, alta pública de organizaciones ni usuarios demo persistentes.
