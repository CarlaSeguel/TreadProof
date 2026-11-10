# Disponibilidad y mantenimiento por 30 días

Responsable definido por el SOW: Christián Javier Medina López. Costos de hosting incluidos en la asignación D2 de USD 2.100. Acceso administrativo del proveedor y pagador: por confirmar antes de contratar o desplegar.

Estado: PLANIFICADO, NO INICIADO. Fecha oficial de entrega: pendiente. Inicio efectivo: pendiente. Fin previsto: inicio oficial más 30 días naturales. No usar la fecha de este expediente como entrega acordada ni afirmar que el período transcurrió.

## Registro mínimo

El responsable registrará fecha/hora UTC y America/Santiago, URL/build/commit, resultado HTTP, motivo del incidente, inicio/fin de indisponibilidad, acción de recuperación y evidencia. Registrar cortes de mantenimiento y de proveedor; no garantizar disponibilidad perfecta.

| Momento | Comprobación |
|---|---|
| Antes de aceptar entrega | HTTPS, build/commit/digest, proxy, evidencia privada, historial y referencias; restauración/rollback ensayados |
| Cada día del período | Abrir frontend y health; comprobar versión y un estado leído; registrar resultado y dependencias |
| Después de reinicio/redeploy | Comparar build y volúmenes; roles/RLS/índice intactos; ninguna operación activada automáticamente |
| Ante error RPC/Auth/Storage | Separar disponibilidad de proveedor y app; mantener evidencia histórica fechada; no reenviar NFU |
| Al finalizar el día 30 | Consolidar fechas reales, controles e incidentes y registrar cierre del período |

Puede automatizarse un GET de salud del mismo origen si el responsable lo autoriza. No se ha creado una automatización, alerta ni monitor con esta preparación. El chequeo de salud no activa wallet, firma, concesiones de escritura o transacciones.

## Respuesta y restauración

1. Registrar el incidente, comprobar proveedor y dependencias y bloquear cualquier acción transaccional si hay incertidumbre.
2. Recuperar únicamente la última imagen/digest aprobados con sus volúmenes y secretos; conservar bases originales y archivos.
3. Aplicar REPRODUCTION-RECOVERY.md. Una restauración de datos o recreación Testnet requiere aprobación separada; el reinicio no renueva ventanas ni resuelve unknown por escritura.
4. Verificar HTTPS, versión, proxy, prueba de bytes autorizada y separación LOCAL/Stellar; registrar recuperación y cualquier tiempo perdido.

Los despliegues con disco Render pueden tener una pausa durante el cambio de instancia. El plan Free también tiene suspensión por inactividad. Registrar estos límites reales en la entrega; no usar peticiones artificiales para prometer disponibilidad no contratada.

La obligación de mantener 30 días puede estar ACTIVA tras la entrega, y solo podrá figurar CUMPLIDA cuando el período y sus registros lo acrediten. Conservar el informe de mantenimiento como evidencia adicional, sin reescribir el tag de código.
