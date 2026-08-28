# Desafio Jungle Gaming — Backend

Processador de transações financeiras distribuído para uma plataforma de iGaming, com foco em correção financeira sob concorrência. Enunciado original: https://github.com/junglegaming/backend-challenge

> Em desenvolvimento, por partes. Este README cobre o essencial para rodar o que já existe; a documentação completa de arquitetura vai para `ARCHITECTURE.md` conforme o domínio for implementado.

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

## Setup

```bash
cp .env.example .env
bun install
docker compose up -d postgres localstack
bun run migration:up
bun run start:dev  # cria/valida as filas SQS no LocalStack sozinho, no boot
```

A API sobe em `http://localhost:3000`.

> **Nota sobre o MikroORM 7**: a versão instalada não usa mais decorators
> (`@Entity`, `@Property`) como API recomendada — usa `defineEntity()` com
> o builder `p` (`src/**/infrastructure/*.orm-entity.ts`). Constraints
> reais (UNIQUE composto, CHECK, FKs, o trigger de imutabilidade do
> ledger) ficam escritas à mão em SQL puro na migration, não declaradas
> nas entidades — ver comentário no topo de `migrations/Migration*.ts`.

## Scripts

| Comando | O que faz |
|---|---|
| `bun run start:dev` | Sobe a API em modo watch |
| `bun run build` | Build de produção |
| `bun run typecheck` | Checagem de tipos sem emitir arquivos |
| `bun run lint` / `lint:fix` | ESLint |
| `bun run format` | Prettier |
| `bun test` | Testes unitários (Bun test runner) |
| `bun run test:integration` | Testes de integração — exige Postgres real (`docker compose up -d postgres` + `migration:up`) |
| `bun run migration:create` | Gera uma nova migration a partir do diff das entidades |
| `bun run migration:up` / `migration:down` | Aplica / reverte migrations |

## Endpoints

```
POST   /wallets                                                     { playerId, currency, initialBalance? }
GET    /wallets/:walletId
GET    /wallets/:walletId/ledger?cursor=&limit=                     paginação por cursor (id, UUIDv7 — ordenável por tempo)
POST   /wallets/:walletId/reconciliation                            recalcula o saldo a partir do ledger
POST   /wagering/transactions                                       header Idempotency-Key: "providerId:externalId"
GET    /wagering/transactions/:transactionId
GET    /providers/:providerId/wagering/transactions/:externalTransactionId
GET    /health/live
GET    /health/ready
GET    /metrics
```

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

## Status atual

- [x] Scaffolding (NestJS + Bun + Docker Compose + health checks)
- [x] Domínio (Money, Wallet, WagerTransaction, WalletLedgerEntry)
- [x] Persistência (MikroORM + migrations com constraints no schema)
- [x] Caso de uso central + concorrência por `walletId` (BET/WIN/LOSS/OPENING/REFUND/ROLLBACK)
- [x] Inbox/Outbox + SQS (produtor: outbox → `integration-events.fifo`; consumidor: `wager-transactions.fifo` → use case)
- [x] API (controllers, DTOs, autenticação — ver nota abaixo)
- [x] REFUND / ROLLBACK / `PENDING_REFERENCE` + worker de reprocessamento
- [x] Observabilidade (logs estruturados JSON, métricas Prometheus, readiness com SQS)
- [ ] Testes de integração/concorrência ampliados (50 apostas paralelas, múltiplas instâncias, recuperação de crash)
- [ ] `ARCHITECTURE.md`
