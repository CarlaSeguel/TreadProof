# 07 — Alcance del MVP v0.1

## Estado de esta entrega

Fase 0 terminada. Fase 1: definición formal del flujo principal, permisos funcionales, masas, reconocimiento y manejo mínimo de excepciones. Las decisiones pendientes se enumeran al final y no deben interpretarse como funcionalidades existentes.

Esta entrega modifica solo los documentos 03 a 07. No escribe contratos Rust, instala dependencias ni implementa frontend, backend, Supabase o conexión a Stellar.

## INCLUIDO EN MVP v0.1

- Trabajo exclusivamente con neumáticos fuera de uso (NFU).
- Empresa solicitante, generador o punto de retiro, transportista, planta y sistema TreadProof.
- Identificación de lotes y de sus actores, con permisos limitados a los lotes propios o asignados.
- Flujo CREATED → PICKED_UP → IN_TRANSIT → RECEIVED → VALORIZED, sin saltos ni reaperturas.
- declared_mass, pickup_mass, received_mass y valorized_mass conservadas por separado.
- Masas positivas, precisión provisional de tres decimales de kg y valorized_mass <= received_mass.
- Diferencias entre retiro y recepción aceptadas y consultables, sin igualdad forzada ni tolerancia automática.
- Valorización registrada exclusivamente por la planta asignada desde RECEIVED, con masa y referencia de evidencia obligatorias.
- Una sola valorización y acreditación por lote; el remanente no recibe puntos ni puede acreditarse posteriormente dentro de este flujo.
- CANCELLED antes del retiro por la empresa; REJECTED por la planta desde IN_TRANSIT o RECEIVED; DISPUTED antes de VALORIZED por participantes autorizados. Motivo e historial obligatorios.
- Bloqueo del flujo para disputas; sin resolución o reapertura automática en el MVP.
- TirePoints no transferibles para la empresa solicitante: 1 kg valorizado y verificado = 1 TP.
- Cierre, acreditación y actualización del reconocimiento con resultado indivisible; prevención de doble acreditación del mismo lote.
- Insignias no transferibles TRACE I, RECOVER II, CIRCULAR III, IMPACT IV y CHAMPION V según los umbrales documentados.
- Dashboard web previsto para consulta de lotes, mediciones, puntos e insignias.
- Stellar Testnet y smart contracts Soroban/Rust como destino de la futura implementación.
- Casos de aceptación para permisos, transiciones, masas, evidencia, duplicados y umbrales.

## NO INCLUIDO EN MVP v0.1

- IoT, GPS, cámaras o básculas reales.
- Pagos, escrow o stablecoins.
- RETC e integraciones regulatorias automáticas.
- Créditos de carbono, certificaciones oficiales o tokens transferibles.
- Otros residuos o despliegue en mainnet.
- Verificadores externos, oráculos o comprobación automática del tratamiento físico.
- NFT obligatorio para representar insignias.
- Arbitraje, resolución de disputas y reapertura de lotes.
- Valorizaciones sucesivas, división de lotes y reasignación de remanentes.
- Edición de mediciones previas, reasignación de actores, reversión de TirePoints y revocación de insignias.

## Decisiones adoptadas para cerrar reglas operativas

Además de las reglas solicitadas, se adoptan convenciones mínimas: declared_mass positiva, precisión de gramos, actores fijos por lote, acumulación histórica de puntos e insignias, un solo cierre por lote y transiciones de excepción limitadas. Estas decisiones son de producto para el MVP, no exigencias regulatorias.

La expresión «verificado» se limita al registro de la planta respaldado por referencia de evidencia y validaciones del sistema. Blockchain no prueba por sí sola la realidad del tratamiento.

## Ambigüedades y diseño pendientes

### Antes de implementar los campos y permisos correspondientes

1. Identidad y alta: decidir quién autoriza organizaciones y roles, y cómo se vinculan con las identidades firmantes. Ninguna identidad debe poder autoasignarse privilegios de planta arbitrariamente.
2. Evidencia: fijar formato de referencia, uso de huella digital y política mínima de conservación/consulta. La referencia no vacía es necesaria, pero no demuestra autenticidad o disponibilidad.
3. Representación numérica: convertir la precisión acordada a tipos de datos, límites y controles de desbordamiento, sin aritmética de coma flotante para masas o saldos.

### Antes de afirmar validación operativa con material real

4. Doble conteo físico: definir controles de origen y cotejo entre lotes; la acreditación única por lote no garantiza que el mismo material no haya sido declarado con otro identificador.
5. Valorización: acordar con la planta qué tratamientos y documentos acepta el piloto, sin introducir certificación oficial ni reglas regulatorias no validadas.
6. Correcciones: si el piloto requiere resolver disputas o impugnar lotes cerrados, definir el procedimiento y sus efectos antes de habilitar esas operaciones.

### Antes de la aplicación y un piloto público

7. Acordar datos públicos/privados y acceso a evidencias.
8. Identificar un caso piloto y validar el flujo con sus participantes.

## Preparación para Rust/Soroban

Las reglas del núcleo permiten pasar a una primera implementación de prototipo: estados, masas, acreditación única y umbrales tienen criterios comprobables en [04_workflow.md](04_workflow.md) y [06_badges.md](06_badges.md).

Antes de escribir las partes dependientes deben concretarse identidad, formato de evidencia y tipos numéricos. El prototipo puede usar actores y documentos de prueba explícitamente identificados; no debe presentarse como verificación física independiente ni garantía de ausencia de doble conteo entre lotes.

Esta fase no inicia implementación. El siguiente paso debe anunciar el paso a diseño técnico e implementación Rust/Soroban, dentro del alcance autorizado por el usuario.

## Nota técnica — inicio de Fase 2

Por instrucción posterior del usuario se inicia exclusivamente TireRegistry en `contracts/tire_registry/`: direcciones Stellar fijas por lote, masas `u64` en gramos y hash de evidencia de 32 bytes sin documentos on-chain. Se implementan el flujo y las excepciones de Fase 1. En esta entrega `VALORIZED` cierra el registro sin generar TirePoints ni badges; la atomicidad con el reconocimiento sigue siendo un requisito futuro del producto completo. No se implementan ImpactRegistry, frontend, Supabase ni despliegue a una red. El diseño técnico y comandos están en [la nota de TireRegistry](../contracts/tire_registry/README.md).

## Nota técnica — Fase 3: ImpactRegistry y TirePoints

Se incorpora ImpactRegistry como contrato separado, sin modificar TireRegistry. Su dirección de origen queda fija al desplegar y `credit_batch(batch_id)` consulta directamente el lote en TireRegistry; el llamante no elige empresa ni masa. Solo se acredita VALORIZED con masa y evidencia válidas, una vez por lote dentro de esta instancia. Se conservan gramos acumulados `u128`, contador por empresa y recibo persistente por lote; los TirePoints completos se derivan dividiendo por 1.000, conservando el resto de gramos.

La acreditación puede activarla cualquier persona sin redirigir el beneficio. Saldo, contador y recibo se actualizan atómicamente. **El cierre del lote y su acreditación siguen siendo operaciones separadas en este MVP:** puede haber lotes cerrados pendientes de acreditar. La atomicidad entre ambos contratos descrita para el producto completo queda pendiente y no se promete automatización. Esta limitación y la necesidad de un despliegue canónico se explican en [ImpactRegistry](../contracts/impact_registry/README.md). No se implementan badges, frontend ni despliegue en Testnet.

## Nota técnica — Fase 4: Circular Badge Credentials

Se añade BadgeContract en `contracts/badge/`, sin modificar TireRegistry ni ImpactRegistry. Fija ImpactRegistry en su constructor y consulta su acumulado en gramos para emitir credenciales históricas no transferibles: TRACE, RECOVER, CIRCULAR, IMPACT y CHAMPION. Sus umbrales son 1.000.000, 10.000.000, 25.000.000, 50.000.000 y 100.000.000 gramos respectivamente, sin floats ni balances proporcionados por el usuario.

`check_and_unlock(company)` puede activarlo cualquier usuario, beneficia solo a la empresa consultada y registra cada nivel una sola vez conservando los inferiores y la evidencia original. El desbloqueo es explícito y posterior a la acreditación: no hay actualización automática ni transacción única que abarque los tres contratos. Las credenciales no son certificaciones oficiales, créditos de carbono, activos financieros ni tokens comerciales. No se implementan transferencias, frontend, Supabase o despliegue en Testnet. Diseño, limitaciones y comandos en [BadgeContract](../contracts/badge/README.md).
