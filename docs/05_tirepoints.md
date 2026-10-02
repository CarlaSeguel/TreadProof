# 05 — TirePoints

## Regla provisional

**1 kg de NFU valorizado y verificado = 1 TirePoint.**

En el MVP, la planta asignada declara la valorización con una referencia de evidencia y el sistema valida las reglas. Esta verificación no equivale a una auditoría externa del tratamiento físico.

## Generación y beneficiario

- Se generan únicamente como parte de la transición válida RECEIVED → VALORIZED.
- Se calculan exclusivamente a partir de valorized_mass, nunca de la masa declarada, retirada o recibida.
- Se asignan a la empresa solicitante fijada al crear el lote.
- El registro de acreditación relaciona lote, empresa y cantidad. Un lote no puede otorgar TirePoints más de una vez.
- Un mismo kg no puede acreditarse dos veces.
- El saldo de la empresa es la suma de sus acreditaciones válidas; no admite aumentos manuales.
- El cierre y la acreditación deben completarse juntos o no producir ningún cambio. Una repetición del cierre falla sin acreditar otra vez.

## Naturaleza y restricciones

Los TirePoints no son transferibles, comprables ni vendibles. No representan dinero ni créditos de carbono. Son un registro de reconocimiento dentro de TreadProof; no es obligatorio implementar un token fungible.

## Precisión y valorización parcial

Se mantiene la precisión de hasta tres decimales acordada para kg: 1,250 kg equivale a 1,250 TP. No se redondea hacia arriba ni se eliminan fracciones al acumular.

Si se reciben 5.000 kg y se valorizan 4.900 kg, se acreditan 4.900 TP. Los 100 kg restantes no generan puntos. El lote se cierra una sola vez y no permite posteriores acreditaciones del remanente en este MVP.

## Prevención de doble acreditación y límites

El sistema debe rechazar identificadores de lote duplicados, cierres repetidos e intentos concurrentes de acreditar el mismo lote. La empresa beneficiaria y las mediciones ya registradas no pueden sustituirse para intentar un nuevo reconocimiento.

La prohibición de acreditar un mismo kg también rige entre lotes. Sin embargo, un identificador único no permite detectar por sí solo que dos declaraciones corresponden al mismo material físico. El protocolo de origen y cotejo de evidencias entre lotes sigue pendiente; no se afirmará que el MVP garantiza automáticamente esa detección. No basta con bloquear referencias documentales repetidas: un documento podría cubrir varios lotes.

## Excepciones y correcciones

Los estados CANCELLED, REJECTED y DISPUTED no generan TirePoints. Las transiciones hacia ellos se limitan a estados previos a VALORIZED según [04_workflow.md](04_workflow.md).

El MVP no ofrece edición, reversión ni revocación de una acreditación cerrada. Una política de correcciones y su efecto en insignias debe definirse antes de un uso operativo que necesite corregir declaraciones ya acreditadas. No se debe resolver un duplicado físico creando ajustes manuales no trazados.
