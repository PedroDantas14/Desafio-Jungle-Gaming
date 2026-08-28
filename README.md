# Desafio Jungle Gaming — Backend

Processador de transações financeiras distribuído para uma plataforma de iGaming, com foco em correção financeira sob concorrência. Enunciado original: https://github.com/junglegaming/backend-challenge

Decisões, trade-offs e limitações estão em **[`ARCHITECTURE.md`](./ARCHITECTURE.md)**. Este README cobre setup, comandos e como validar que está tudo funcionando.

## Stack

- Runtime: [Bun](https://bun.sh) 1.x
- Linguagem: TypeScript (strict)
- Framework: NestJS
- Banco: PostgreSQL
- Mensageria: AWS SQS via LocalStack
- ORM: MikroORM 7 (`defineEntity`/`p`, não decorators — ver nota abaixo)
- Orquestração: Docker Compose

## Pré-requisitos

- [Bun](https://bun.sh) >= 1.0
- Docker + Docker Compose

## Setup — passo a passo

```bash
# 1. variáveis de ambiente (valores padrão já servem pra rodar local)
cp .env.example .env

# 2. dependências
bun install

# 3. sobe Postgres + LocalStack (SQS simulado)
docker compose up -d postgres localstack

# 4. aplica as migrations
bun run migration:up
```

> **Se o passo 4 falhar com `MikroORM config file not found`**: é um problema conhecido do CLI do MikroORM neste ambiente (ele só sabe procurar config `.js` por padrão, e o projeto usa `.ts`). O workaround que funciona:
> ```bash
> bun node_modules/@mikro-orm/cli/cli.js migration:up
> ```

```bash
# 5. sobe a API (cria/valida as filas SQS no LocalStack sozinha, no boot)
bun run start:dev
```

A API sobe em `http://localhost:3000`. O terminal fica ocupado mostrando os logs (formato JSON, uma linha por evento) — deixe esse terminal aberto e use outro pra interagir com a API ou rodar comandos.

> **⚠️ Nunca rode a API (`start:dev`) ao mesmo tempo que os testes de integração** (`bun run test:integration`). Os dois usam o **mesmo** Postgres e a **mesma** fila reais — se a API estiver de pé, o consumidor e o publisher dela competem com os testes pelas mesmas mensagens, e os testes falham por interferência, não por bug. Pare a API (`Ctrl+C`) antes de rodar a suíte de integração.

> **Nota sobre o MikroORM 7**: a versão instalada não usa mais decorators
> (`@Entity`, `@Property`) como API recomendada — usa `defineEntity()` com
> o builder `p` (`src/**/infrastructure/*.orm-entity.ts`). Constraints
> reais (UNIQUE composto, CHECK, FKs, o trigger de imutabilidade do
> ledger) ficam escritas à mão em SQL puro na migration, não declaradas
> nas entidades — ver comentário no topo de `migrations/Migration*.ts`.

### Rodando tudo em containers (inclusive a API)

```bash
docker compose up -d --build
```

Sobe Postgres + LocalStack + a própria API containerizada (`Dockerfile`). Pra simular múltiplas instâncias da aplicação (seção 8/13 do desafio — a mesma garantia de lock precisa valer com N processos):

```bash
docker compose up -d --build --scale app=3
```

> Com `--scale`, a porta fixa `3000:3000` do serviço `app` colide entre as réplicas — pra testar de fato com 3+ instâncias simultâneas, remova o mapeamento de porta fixa (deixe só `expose`) e coloque um load balancer na frente, ou acesse cada réplica pelo Docker network interno. As instâncias continuam corretas de qualquer forma — é só o acesso externo por porta fixa que não escala sem ajuste.

## Validando que está tudo funcionando

Com a API rodando (`bun run start:dev`, terminal separado):

```bash
# processo está de pé?
curl http://localhost:3000/health/live

# fala com Postgres e SQS?
curl http://localhost:3000/health/ready

# cria uma carteira com saldo inicial
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{"playerId":"'"$(bun -e 'console.log(crypto.randomUUID())')"'","currency":"BRL","initialBalance":{"amount":"100.00","currency":"BRL"}}'
```

Copie o `id` que voltou e use no lugar de `SEU_WALLET_ID`:

```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: teste:aposta-1" \
  -d '{"providerId":"teste","externalTransactionId":"aposta-1","walletId":"SEU_WALLET_ID","playerId":"SEU_PLAYER_ID","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"30.00","currency":"BRL"}}'
```

Saldo deve cair pra `70.00`. Repita o mesmo comando (mesmo `Idempotency-Key`) — a resposta deve vir com `"idempotentReplay": true` e o saldo **não** deve mudar de novo.

**Coleção do Postman**: se preferir uma interface gráfica em vez de `curl`, peça pro Claude gerar/atualizar a coleção — ela cobre o ciclo completo `BET → WIN → LOSS → REFUND → ROLLBACK`, reconciliação e métricas, com os IDs encadeados automaticamente entre as requisições.

## Scripts

| Comando | O que faz |
|---|---|
| `bun run start:dev` | Sobe a API em modo watch |
| `bun run build` | Build de produção |
| `bun run typecheck` | Checagem de tipos sem emitir arquivos |
| `bun run lint` / `lint:fix` | ESLint |
| `bun run format` | Prettier |
| `bun test` | Testes unitários (Bun test runner) |
| `bun run test:integration` | Testes de integração — exige Postgres + LocalStack reais de pé (ver aviso acima sobre não rodar junto com a API) |
| `bun run migration:create` | Gera uma nova migration a partir do diff das entidades |
| `bun run migration:up` / `migration:down` | Aplica / reverte migrations (ver workaround do CLI acima) |

## Endpoints

```
POST   /wallets                                                     { playerId, currency, initialBalance? }
GET    /wallets/:walletId
GET    /wallets/:walletId/ledger?cursor=&limit=                     paginação por cursor (id, UUIDv7 — ordenável por tempo; limit padrão 50, máx 200)
POST   /wallets/:walletId/reconciliation                            recalcula o saldo a partir do ledger
POST   /wagering/transactions                                       header Idempotency-Key: "providerId:externalId"
GET    /wagering/transactions/:transactionId
GET    /providers/:providerId/wagering/transactions/:externalTransactionId
GET    /health/live
GET    /health/ready
GET    /metrics
```

`money` é sempre `{ "amount": "100.00", "currency": "BRL" }` (string decimal de 2 casas, nunca number). `kind` de `/wagering/transactions`: `BET` | `WIN` | `LOSS` | `REFUND` | `ROLLBACK` — `REFUND`/`ROLLBACK` exigem `referenceExternalTransactionId` no corpo, apontando pro `externalTransactionId` da transação sendo revertida.

## Health checks

- `GET /health/live` — o processo está de pé (sem checar dependências externas)
- `GET /health/ready` — a instância consegue de fato servir tráfego (checa conexão com o Postgres **e** com o SQS/LocalStack)

## Observabilidade

- **Logs estruturados (JSON)** — `JsonLogger` (`src/shared/infrastructure/json-logger.ts`) substitui o logger padrão do Nest via `app.useLogger()`: uma linha JSON por evento, nunca texto livre. Eventos de domínio (`wager_transaction_finalized`, `pending_reference_resolved`, `outbox_message_published`, ...) carregam `transactionId`/`walletId`/`providerId`/`correlationId` — nunca o valor monetário nem o payload bruto de uma mensagem SQS.
- **Métricas Prometheus** — `GET /metrics` (`MetricsService`, `src/shared/infrastructure/metrics.service.ts`): transações por status/kind, duplicatas identificadas (idempotência e redelivery de mensagem), tentativas de reprocessamento de `PENDING_REFERENCE`, mensagens na DLQ (amostradas periodicamente pelo `DlqDepthSampler`), tempo de espera no lock da wallet, atraso do outbox e latência de processamento fim-a-fim.

## Autenticação

Guard (`BearerAuthGuard`) valida `Authorization: Bearer <jwt>` contra o JWKS
de um Identity Provider externo (nunca emite token, só valida — seção 2 do
desafio pede integração com IdP, nunca auth artesanal). **Decisão de
escopo**: autenticação não vale pontos e não deve competir com correção
financeira/concorrência/idempotência — por isso, sem `AUTH_JWKS_URI`
configurado no `.env`, o guard fica desabilitado (loga aviso, deixa
passar). Configurar `AUTH_JWKS_URI` + `AUTH_ISSUER` contra um IdP real
(Keycloak, Zitadel, etc.) liga a validação de verdade.

## Testes (seção 13)

`bun test` roda a suíte unitária (rápida, sem infra externa); `bun run test:integration` exige Postgres + LocalStack reais de pé (ver setup acima) **e a API parada**. Cobertura contra o checklist da seção 13:

- **Unidade**: Money, invariantes de Wallet, regras BET/WIN/LOSS/REFUND/ROLLBACK, conflito de moeda, idempotency key com payload divergente.
- **Integração**: migrations/constraints reais (`src/config/schema-constraints.integration.test.ts`), atomicidade wallet+ledger+inbox+outbox, inbox e redelivery, publishers concorrentes sobre a mesma outbox, retry e DLQ (redrive policy real via LocalStack).
- **Concorrência**: mesma aposta 50x em paralelo, cenário obrigatório da seção 8, wallets distintas em paralelo, ≥3 instâncias simultâneas do use case, worker morto depois do commit e antes do ack, dois publishers na mesma outbox, REFUND/ROLLBACK chegando antes da referência (via use case e via SQS), invariante final `wallet.balance == saldo reconstruído pelo ledger` (reusa `ReconcileWalletUseCase`).

Detalhes de decisões de teste (por que timeouts maiores em alguns arquivos, como o DLQ é provado de verdade, etc.) em `ARCHITECTURE.md`.

## Status atual

- [x] Scaffolding (NestJS + Bun + Docker Compose + health checks)
- [x] Domínio (Money, Wallet, WagerTransaction, WalletLedgerEntry)
- [x] Persistência (MikroORM + migrations com constraints no schema)
- [x] Caso de uso central + concorrência por `walletId` (BET/WIN/LOSS/OPENING/REFUND/ROLLBACK)
- [x] Inbox/Outbox + SQS (produtor: outbox → `integration-events.fifo`; consumidor: `wager-transactions.fifo` → use case)
- [x] API (controllers, DTOs, autenticação — ver nota acima)
- [x] REFUND / ROLLBACK / `PENDING_REFERENCE` + worker de reprocessamento
- [x] Observabilidade (logs estruturados JSON, métricas Prometheus, readiness com SQS)
- [x] Testes de integração/concorrência ampliados (seção 13: 50 apostas paralelas, wallets distintas, ≥3 instâncias, crash pós-commit/pré-ack, publishers concorrentes, retry/DLQ, constraints reais)
- [x] `ARCHITECTURE.md`
