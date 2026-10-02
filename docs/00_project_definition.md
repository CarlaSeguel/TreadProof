# 00 — Definición del proyecto

## Qué es TreadProof

TreadProof es una plataforma construida sobre Stellar para trazabilidad verificable de neumáticos fuera de uso (NFU). Su lógica central es **Trace → Verify → Reward**.

## Objetivo

Documentar el recorrido de cada lote desde su creación hasta su valorización, conservar las mediciones y evidencias de sus etapas y reconocer los kg efectivamente valorizados y verificados mediante TirePoints e insignias no transferibles.

## Problema

La hipótesis inicial es que la información de retiro, transporte, recepción y tratamiento puede quedar fragmentada entre actores, dificultando su revisión y la atribución de cantidades valorizadas. Esta hipótesis debe validarse con posibles usuarios; todavía no se afirma que exista un piloto o demanda comercial demostrada.

## Propuesta de valor

Ofrecer una historia consultable por lote, con responsables identificados, mediciones por etapa y referencias a evidencias. El reconocimiento de una empresa debe derivarse de registros de valorización verificados, sin depender únicamente del peso declarado al crear un lote.

## Base tecnológica y unidad

- Blockchain: **Stellar**.
- Red inicial: **Stellar Testnet**.
- Smart contracts: **Soroban**.
- Lenguaje de contratos: **Rust**.
- Unidad base: **kg de NFU valorizados**.

## Límites de la verificación

Un registro en blockchain no demuestra por sí mismo que ocurrió un tratamiento físico. La verificación requiere evidencias y responsables identificados. El criterio de valorización admisible y quién puede verificarlo deben definirse en Fase 1.

Los TirePoints registran una cantidad de NFU valorizados bajo esas reglas; no equivalen a una medición completa de beneficio ambiental ni a créditos de carbono. Las insignias no se presentan como certificaciones regulatorias.

## Estado

MVP v0.1 en fase de definición. El alcance acordado se encuentra en [07_mvp_scope.md](07_mvp_scope.md). No hay funcionalidades implementadas.
