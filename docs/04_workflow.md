# 04 — Flujo, masas y excepciones

## Flujo principal

```text
CREATED → PICKED_UP → IN_TRANSIT → RECEIVED → VALORIZED
```

| Acción | Estado requerido | Estado resultante | Actor autorizado | Datos y condiciones |
| --- | --- | --- | --- | --- |
| Crear lote | No existe el identificador | CREATED | Empresa solicitante | Identificador único, empresa, origen, transportista, planta y declared_mass. |
| Confirmar retiro | CREATED | PICKED_UP | Transportista asignado | pickup_mass > 0. |
| Iniciar transporte | PICKED_UP | IN_TRANSIT | Transportista asignado | Conservar el registro de retiro. |
| Confirmar recepción | IN_TRANSIT | RECEIVED | Planta asignada | received_mass > 0. |
| Registrar valorización | RECEIVED | VALORIZED | Planta asignada | valorized_mass > 0, valorized_mass <= received_mass y referencia de evidencia no vacía. Lote aún no acreditado. |

Solo existen las transiciones expresamente enumeradas en este documento. Si falla cualquier condición, se rechaza la operación completa sin alterar estado, mediciones, puntos ni insignias.

La transición a VALORIZED y la acreditación única deben tener un resultado indivisible: no puede quedar un lote cerrado sin sus puntos ni puntos otorgados sin cierre. La misma regla incluye la actualización del reconocimiento correspondiente.

## Mediciones independientes

| Campo | Significado | Momento de registro |
| --- | --- | --- |
| declared_mass | Estimación de kg de NFU del lote. | Creación. |
| pickup_mass | Kg de NFU declarados al retirar. | Confirmación de retiro. |
| received_mass | Kg de NFU declarados al recibir. | Confirmación de recepción. |
| valorized_mass | Kg de NFU de ese lote cuyo tratamiento declara la planta, respaldados por referencia de evidencia. No es necesariamente el peso de los productos de salida. | Valorización. |

- Guardar cada campo por separado, sin sobrescribir mediciones previas.
- No asumir igualdad entre declared_mass, pickup_mass y received_mass.
- pickup_mass, received_mass y valorized_mass deben ser estrictamente positivos.
- valorized_mass no puede superar received_mass.
- Una masa de una etapa aún no realizada está ausente, no equivale a cero.
- Como convención provisional del MVP, declared_mass también debe ser positiva.
- Como convención de precisión del MVP, admitir hasta tres decimales de kg, equivalentes a gramos enteros; rechazar precisión adicional, valores negativos y valores fuera del rango admitido. No redondear al alza. El rango numérico se concretará al diseñar los tipos del contrato.

## Diferencias de peso

**received_mass mayor o menor que pickup_mass:** aceptar la recepción si es positiva, conservar ambas mediciones y dejar la diferencia consultable. No corregir automáticamente pickup_mass ni abrir una disputa automáticamente. No hay tolerancias porcentuales ni reglas regulatorias en el MVP. Un actor autorizado puede abrir una disputa si cuestiona la diferencia.

**valorized_mass menor que received_mass:** permitir el cierre y acreditar solo valorized_mass. La diferencia queda sin acreditar. Para simplificar el MVP hay un único cierre por lote: no se permiten valorizaciones sucesivas, divisiones o traspasos del remanente a otro lote. Su tratamiento futuro requiere reglas adicionales de trazabilidad.

**valorized_mass mayor que received_mass o masas inválidas:** rechazar la operación sin cambios.

## Estados de excepción

Las siguientes son decisiones operativas conservadoras para el MVP, no reglas regulatorias.

| Transición permitida | Actor | Condición y efecto |
| --- | --- | --- |
| CREATED → CANCELLED | Empresa solicitante del lote | Motivo obligatorio. Cancelación antes del retiro; conservar historial, sin puntos. |
| IN_TRANSIT → REJECTED | Planta asignada | Motivo obligatorio de rechazo de recepción. No exigir una received_mass ficticia ni acreditar puntos. |
| RECEIVED → REJECTED | Planta asignada | Motivo obligatorio de rechazo previo al cierre, por ejemplo evidencia insuficiente. Conservar received_mass, sin puntos. |
| CREATED, PICKED_UP, IN_TRANSIT o RECEIVED → DISPUTED | Empresa solicitante, transportista asignado o planta asignada | Motivo obligatorio; conservar el estado previo y todas las mediciones. Bloquear el flujo y la acreditación. |

- CANCELLED y REJECTED son terminales en el MVP. No borran registros ni habilitan reapertura.
- DISPUTED queda bloqueado y requiere revisión fuera del flujo automático. La versión inicial no ofrece una transición de resolución o reanudación; definirla es trabajo posterior.
- Rechazar o cancelar el registro no prueba devolución, traslado ni tratamiento físico del material.
- Después del retiro no se permite cancelar: si existe un problema debe registrarse una disputa o el rechazo permitido para la planta.
- VALORIZED es terminal. Una segunda valorización falla sin generar puntos adicionales.
- No se permite convertir un lote VALORIZED en un estado de excepción en este MVP. Una objeción posterior requiere una futura política de correcciones y revocación; no se oculta ni se resuelve cambiando el saldo manualmente.
- Reintentar una transición ya completada o intentar cualquier salto de estados produce un error sin cambios.

## Evidencia mínima de valorización

Se requiere una referencia no vacía que identifique el documento o registro que respalda la declaración de la planta. Debe quedar asociada al lote, masa y actor y conservarse en el historial. No basta un texto genérico como «verificado».

El formato exacto de referencia, su huella digital y las reglas de conservación y consulta deben concretarse antes de implementar el campo. La mera presencia de la referencia no demuestra autenticidad ni disponibilidad del documento. Esta fase no implementa almacenamiento.

## Casos de aceptación para la futura implementación

1. Empresa crea un lote y solo los actores asignados completan las etapas en orden.
2. Masas declarada 5.100 kg, retirada 5.000 kg, recibida 4.950 kg y valorizada 4.900 kg se conservan; el cierre acredita 4.900 TP.
3. Una recepción superior al retiro se acepta si es positiva; la diferencia permanece visible.
4. Masa cero, negativa, precisión excesiva, valorización superior a recepción o evidencia vacía impiden la operación.
5. Un actor ajeno o un salto de estado no cambia ningún dato.
6. Una segunda valorización falla y no cambia el saldo ni duplica insignias.
7. Cancelación, rechazo y disputa solo se admiten con los permisos y estados de la tabla y nunca otorgan puntos.
8. Un fallo de acreditación durante el cierre no deja el lote en VALORIZED.
