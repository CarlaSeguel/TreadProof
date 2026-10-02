# Fase 5 — Stellar Testnet

Completada el **2 de octubre de 2026**. Los tres contratos están desplegados y enlazados, y el lote sintético **TP-DEMO-0001 / batch_id 1** terminó en `Valorized`, con **4.900.000 gramos**, **4.900 TirePoints** y una sola credencial **TRACE I**.

- [Despliegues, identidades, hashes y transacciones](deployments.md).
- [Comandos, parámetros, resultados y pruebas negativas](demo_flow.md).
- [Manifiesto público](../../deployments/testnet.json).
- [Identificación y hash del lote DEMO](../../deployments/demo-testnet.json).
- [Confirmación de las 14 transacciones](evidence/confirmed-transactions.json).
- [Comprobación local de secretos e ignores](evidence/local-security-check.json).

## Revalidar este despliegue

En PowerShell 7, desde la raíz del proyecto:

```powershell
Set-Location -LiteralPath 'C:\Users\Christián\Documents\Codex\TreadProof'
./scripts/testnet/verify.ps1
./scripts/testnet/audit.ps1
./scripts/testnet/quality.ps1
```

`verify.ps1` consulta estado con `--send no` y comprueba todas las condiciones. `audit.ps1` descarga los Wasm desplegados, compara SHA-256 y consulta los resultados de transacciones. `quality.ps1` ejecuta formato, Clippy y las dos baterías de 98 pruebas. Requieren las identidades locales para los comandos CLI; no imprimir ni copiar su contenido a documentación.

## Reproducir despliegue y demo

En una copia nueva del proyecto, con Rust 1.98.1, target `wasm32v1-none`, Stellar CLI 28.0.0 y dependencias disponibles, compilar en orden:

```powershell
# Solo si se dispone del toolchain local de este equipo:
. ./scripts/Use-LocalRust.ps1
stellar contract build --package tire-registry --locked --optimize=false
stellar contract build --package impact-registry --locked --optimize=false
stellar contract build --package badge-contract --locked --optimize=false
./scripts/testnet/deploy.ps1
./scripts/testnet/demo.ps1
./scripts/testnet/audit.ps1
./scripts/testnet/quality.ps1
```

Los scripts actuales usan el toolchain local mediante `Use-LocalRust.ps1`; en otro equipo hay que provisionarlo o adaptar esa carga al Rust instalado. `--offline` supone que el caché Cargo ya está disponible. `stellar` debe estar en PATH; los scripts también detectan la ruta de instalación de Windows usada en esta entrega.

Para una reproducción independiente, usar una carpeta nueva sin los manifiestos generados `deployments/testnet.json`, `deployments/demo-testnet.json`, sin `docs/testnet/evidence/` ni `.tools/stellar-testnet/`. Conservar estos archivos en la entrega original. Se crearán tres identidades distintas y nuevos IDs. No reutilizar la evidencia histórica para un despliegue nuevo.

`deploy.ps1` ejecuta los checks antes de desplegar, financia las tres cuentas de prueba, despliega en orden y valida las referencias canónicas. Se detiene si ya existe el manifiesto para evitar sobrescribir la entrega. `demo.ps1` reutiliza los pasos exitosos guardados cuando los argumentos coinciden: puede reanudar el mismo demo y vuelve a consultar su estado sin crear otro lote. Un intento fallido o una respuesta de red incierta exige revisar la evidencia y la red antes de reintentar; no borrar registros para forzar reenvíos.

El archivo `evidence/TP-DEMO-0001.txt` es la evidencia sintética cuyo SHA-256 se registró. Mantener sus bytes exactos. El contrato identifica lotes por número: la etiqueta DEMO se relaciona fuera de cadena en el manifiesto y estos documentos.

## Calidad y seguridad

- Rust: **98/98**, Wasm: **98/98**, antes del despliegue y al finalizar.
- `cargo fmt --all -- --check`: correcto.
- `cargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings`: correcto, sin advertencias.
- Los 20 archivos existentes de contratos conservan sus hashes previos. No se modificó lógica de negocio.
- Los tres Wasm recuperados de Testnet coinciden con los hashes locales desplegados.
- Identidades privadas y cachés permanecen en `.tools/stellar-testnet/`, ignorado por `.gitignore`. No hay secretos en los manifiestos, documentos ni evidencia pública revisada.
- `git status` devuelve que no hay un repositorio Git válido. No existe índice del proyecto que inspeccionar; no se crearon commits ni se publicó nada en GitHub. Las reglas de exclusión se comprobaron usando metadatos Git temporales aislados dentro de `.tools/`, sin inicializar el proyecto.

## Límites

El demo usa datos sintéticos, sin tratamiento físico real ni certificación ambiental. Cierre, acreditación y desbloqueo son tres transacciones separadas. La unicidad se garantiza por lote dentro del registro canónico, no por material físico entre declaraciones distintas. Testnet puede reiniciarse y el almacenamiento tiene TTL; la evidencia de esta entrega no promete disponibilidad permanente del estado ni de los resultados RPC históricos. El mantenimiento y restauración siguen pendientes antes de un piloto operativo.

No se implementó frontend, Supabase, backend web ni funcionalidades fuera de la Fase 5.
