# 03 — Actores y permisos MVP

Fase 1: reglas funcionales. Ninguna funcionalidad está implementada todavía.

## Actores

| Actor | Responsabilidad y permisos |
| --- | --- |
| Empresa solicitante | Crear una solicitud/lote a su nombre, consultar sus lotes y recibir los TirePoints e insignias correspondientes. Puede cancelar un lote propio únicamente en CREATED. |
| Generador o punto de retiro | Identificar el origen y entregar el material. Puede coincidir con la empresa solicitante. No tiene permisos independientes para cambiar estados o acreditar impacto en el MVP. |
| Transportista asignado | Consultar los lotes asignados, confirmar retiro con pickup_mass y ejecutar CREATED → PICKED_UP y PICKED_UP → IN_TRANSIT. |
| Planta valorizadora asignada | Consultar los lotes asignados, confirmar recepción con received_mass y ejecutar IN_TRANSIT → RECEIVED. Registrar valorized_mass y referencia de evidencia para ejecutar RECEIVED → VALORIZED. Puede rechazar conforme a las reglas del flujo. |
| Sistema TreadProof | Validar identidad autorizada, estado, masas y evidencia requerida; prevenir doble acreditación por lote, calcular TirePoints y actualizar insignias. No declara ni observa el tratamiento físico. |

## Verificación en el MVP

La planta asignada registra y respalda la valorización. TreadProof comprueba las reglas y la presencia de una referencia de evidencia; no verifica automáticamente la autenticidad material del documento ni el tratamiento físico.

Por tanto, «verificado dentro de TreadProof» significa una valorización declarada por la planta asignada, con evidencia referenciada y controles del sistema. No significa auditoría independiente ni certificación oficial. Un verificador externo u oráculo podrá incorporarse en versiones posteriores.

## Reglas comunes de autorización

- Los permisos se limitan a lotes propios o asignados; poseer un rol no permite operar sobre cualquier lote.
- Empresa solicitante, transportista y planta se identifican al crear el lote. Para simplificar el MVP, no se permite reasignarlos dentro de un lote existente.
- La empresa solicitante queda fijada como única beneficiaria; ningún actor puede elegir otro destinatario al valorizar.
- Empresa solicitante, transportista asignado o planta asignada pueden abrir una disputa antes de VALORIZED según el flujo documentado.
- Cada cambio registra actor, estado anterior, estado nuevo y fecha; las excepciones requieren motivo.
- Ningún actor puede editar mediciones anteriores, saltar estados, acuñar puntos manualmente ni transferir puntos o insignias.
- TreadProof es la lógica de validación, no un actor con permiso para declarar kg por cuenta de la planta.

## Decisiones pendientes de diseño técnico

Definir el alta de organizaciones, quién autoriza sus roles y la relación entre organización, usuario e identidad firmante. Estos controles deberán resolverse antes de implementar los permisos; la matriz funcional anterior ya está definida.

La consulta pública y el acceso a documentos privados se decidirán antes de implementar la aplicación. Esta fase no configura wallets ni servicios.
