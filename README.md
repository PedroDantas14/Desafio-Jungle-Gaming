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
bun run start:dev
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
| `bun test` | Testes (Bun test runner) |
| `bun run migration:create` | Gera uma nova migration a partir do diff das entidades |
| `bun run migration:up` / `migration:down` | Aplica / reverte migrations |

## Health checks

- `GET /health/live` — o processo está de pé (sem checar dependências externas)
- `GET /health/ready` — a instância consegue de fato servir tráfego (checa conexão com o Postgres)

## Status atual

- [x] Scaffolding (NestJS + Bun + Docker Compose + health checks)
- [x] Domínio (Money, Wallet, WagerTransaction, WalletLedgerEntry)
- [x] Persistência (MikroORM + migrations com constraints no schema)
- [ ] Caso de uso central + concorrência por `walletId`
- [ ] Inbox/Outbox + SQS
- [ ] API (controllers, DTOs, autenticação)
- [ ] REFUND / ROLLBACK / `PENDING_REFERENCE` + worker de reprocessamento
- [ ] Observabilidade
- [ ] Testes de integração/concorrência
- [ ] `ARCHITECTURE.md`
