# Verificación independiente de un lote NFU

Desde una copia local del release de TreadProof, con Node.js 24, instala las dependencias fijadas del verificador una sola vez.

```powershell
npm --prefix backend ci --omit=dev
```

Descarga el informe JSON del revisor y el PDF con tu permiso vigente. Luego ejecuta el verificador desde la raíz de la copia local. El backend TreadProof puede estar apagado.

```powershell
node backend/scripts/verify-nfu-report.mjs "informe.json" "evidencia.pdf" "https://soroban-testnet.stellar.org/"
```

El tercer argumento es opcional y permite elegir otro RPC HTTPS de Stellar Testnet. El informe y el PDF se leen localmente. Al RPC solo se le envían las consultas de red, estado del lote y transacción. Se usa el contrato TireRegistry fijado en el manifiesto del release.

| Resultado | Salida | Significado |
| --- | --- | --- |
| PASS | 0 | La invocación de valorización, la firma de Plant, el resultado, el lote y el PDF coinciden. |
| FAIL | 1 | Se comprobó una discrepancia o el informe es inválido. |
| UNVERIFIED | 2 | Falta información necesaria, por ejemplo, por retención, indisponibilidad del RPC o un formato de transacción fuera del perfil del demo. |

Conserva el JSON del resultado. Incluye endpoint, tiempos de observación, ledger de la transacción y de la lectura del lote, y ventana histórica cuando el RPC la informa. Las lecturas de estado y de transacción son consultas separadas. El informe identifica los datos declarados por el operador. La verificación cubre la transacción y los bytes de evidencia, y deja fuera la afiliación, el tratamiento físico y la certificación ambiental.

El perfil acepta el envelope simple del demo, con Plant como cuenta fuente y su firma Ed25519 verificada sobre el hash de la transacción. También compara la invocación y el cambio de estado del lote. Los envelopes fee-bump quedan sin verificar.

La referencia de transacción debe estar en el informe. Si el RPC devuelve `NOT_FOUND` o el resultado ya no está en retención, conserva el resultado como `UNVERIFIED` y el recibo anterior como evidencia archivada. [Referencia Stellar RPC sobre retención](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction)
