# Guion de video D2 de aproximadamente cuatro minutos y medio

Objetivo: mostrar el ciclo sintético NFU del lote #3, con transacciones reales Testnet y evidencia privada Plant verificable. Este video no requiere otra operación, ni nueva firma o envío.

| Tiempo | Pantalla y acción | Narración y comprobación |
|---|---|---|
| 0:00–0:20 | Portada con nombre, versión candidata y Testnet | «Demostración sintética NFU; no certifica tratamiento físico. Company, Carrier y Plant tienen wallets distintas.» |
| 0:20–0:45 | Manifiesto y participantes, UUID/lote #3 | Mostrar direcciones G, cuatro mediciones en gramos; no presentar pagador como autor Plant |
| 0:45–1:10 | Referencia create_batch | Hash b1bf0615…649fa6, SUCCESS, ledger 5589704; 1000 g |
| 1:10–1:35 | confirm_pickup y start_transit | Hashes b69224eb…20c9d4 / adbe71a9…a325ef, ledgers 5645267 / 5648484; retirada 950 g, transición InTransit |
| 1:35–2:00 | confirm_reception | 567d93be…fb99e5, ledger 5649550; Plant Received/925 g |
| 2:00–2:35 | confirm_valorization | 899881ab…ccd9e66, ledger 5651173; Valorized/900 g, firma de Plant y SHA-256 del contrato |
| 2:35–3:10 | Recuperación privada ya autorizada y hash local del PDF | Mostrar nombre, 76.314 bytes, evidenceId y digest completo 028a738e…41a9228d. No volver a registrar/cargar el documento |
| 3:10–3:40 | Historial local y verificación independiente | «confirmed LOCAL y ledger registrado son persistencia. SUCCESS/estado consultados en Stellar son evidencia de red. Este corte tiene fecha.» Preparaciones históricas no son nuevas confirmaciones |
| 3:40–4:10 | URL HTTPS del build final y manifest/release | Mostrar commit/tag y build reales solo después de publicar; actualmente esa escena queda pendiente. No usar el fixture antiguo como #3 |
| 4:10–4:30 | Reproducción y mantenimiento | Señalar procedimiento/revisor, límites Testnet, responsable y período real de 30 días; crédito y badge son llamadas separadas |

## Preparación de captura

- Capturar el origen HTTPS final y la versión de Chrome/Freighter que realmente se utilice. Si se graba ahora sobre localhost, rotularlo como validación local; no sustituye la escena alojada.
- Usar zoom legible y evitar correo, contraseña, JWT, consola con payloads, seeds, firmas o XDR en pantalla. No publicar los bytes del documento privado por el solo hecho de grabar.
- Abrir las URLs de las cinco transacciones del manifiesto; los hashes abreviados del guion sirven solo para orientación. La evidencia y el manifiesto conservan los completos.
- Los pasos históricos se muestran mediante sus registros confirmados. No pulsar REVIEW/PREPARE/SIMULATE/APPROVE/firma/envío para repetirlos.
- Si el hash ya no está retenido, mostrar su recibo archivado y fecha de verificación; no fingir una lectura actual.
- Revisar el video completo y calcular SHA-256 sobre el archivo final; guardar duración, URL, fecha, commit/build y responsable. Video todavía no grabado con este guion.
