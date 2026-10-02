# 06 — Insignias

## Umbrales provisionales

Los puntos de la tabla son separadores de miles.

| Insignia | Saldo mínimo acumulado |
| --- | ---: |
| TRACE I | 1.000 TP |
| RECOVER II | 10.000 TP |
| CIRCULAR III | 25.000 TP |
| IMPACT IV | 50.000 TP |
| CHAMPION V | 100.000 TP |

## Reglas funcionales MVP

- Las insignias pertenecen a la empresa solicitante y son no transferibles. No se venden ni se ceden.
- Se calculan a partir del saldo acumulado histórico de TirePoints de esa empresa; no hay reinicio por período en el MVP.
- Cada umbral se cumple cuando el saldo es mayor o igual al mínimo indicado.
- Al acreditar un lote, TreadProof actualiza todas las insignias cuyo umbral se haya alcanzado. Un salto de varios umbrales desbloquea todos los niveles correspondientes.
- Cada nivel se concede una sola vez a la empresa bajo estas reglas. Se conservan los niveles anteriores y se muestra como nivel actual el mayor alcanzado.
- Con menos de 1.000 TP la empresa todavía no tiene insignia.
- Reconsultar o recalcular una insignia no genera puntos ni duplicados.
- No es obligatorio implementar NFT en el MVP. La representación técnica queda para la etapa de diseño del contrato.

## Significado y verificabilidad

Representan impacto circular verificado dentro de TreadProof, basado en los kg declarados por la planta y aceptados según las reglas del sistema. No representan una medición completa del beneficio ambiental.

No deben presentarse como certificación oficial, auditoría independiente ni crédito de carbono.

La consulta de una insignia debe identificar empresa, nivel, umbral, fecha de obtención y reglas aplicadas, y permitir relacionarla con las acreditaciones que la respaldan. La visibilidad pública de datos y evidencias se decidirá antes de implementar la aplicación.

## Ejemplos de aceptación

- 999,999 TP: sin insignia.
- 1.000 TP: TRACE I.
- 25.000 TP: TRACE I, RECOVER II y CIRCULAR III; nivel actual CIRCULAR III.
- 100.000 TP: todos los niveles; nivel actual CHAMPION V.
- Un nuevo cálculo con el mismo saldo no duplica insignias.

## Cambios futuros

Estos umbrales son provisionales pero quedan fijos para la primera implementación. Cambiarlos requerirá una nueva decisión documentada sobre el efecto en insignias existentes.

El MVP no incluye vencimiento ni revocación. La política ante corrección de acreditaciones queda pendiente antes de un uso operativo que requiera esa capacidad.
