# Desafio Jungle Gaming — Backend

Processador de transações financeiras distribuído para uma plataforma de iGaming, com foco em correção financeira sob concorrência. Enunciado original: https://github.com/junglegaming/backend-challenge

> Em desenvolvimento, por partes. Este README cobre o essencial para rodar o que já existe; a documentação completa de arquitetura vai para `ARCHITECTURE.md` conforme o domínio for implementado.

## Stack

- Runtime: [Bun](https://bun.sh) 1.x
- Linguagem: TypeScript (strict)
- Framework: NestJS
- Banco: PostgreSQL
- Mensageria: AWS SQS via LocalStack
- ORM: MikroORM (a definir se preferido ou TypeORM)
- Orquestração: Docker Compose

## Pré-requisitos

- [Bun](https://bun.sh) >= 1.0
- Docker + Docker Compose

## Setup

```bash
cp .env.example .env
bun install
docker compose up -d postgres localstack
bun run start:dev
```

A API sobe em `http://localhost:3000`.

## Scripts

| Comando | O que faz |
|---|---|
| `bun run start:dev` | Sobe a API em modo watch |
| `bun run build` | Build de produção |
| `bun run typecheck` | Checagem de tipos sem emitir arquivos |
| `bun run lint` / `lint:fix` | ESLint |
| `bun run format` | Prettier |
| `bun test` | Testes (Bun test runner) |

## Health checks

- `GET /health/live` — o processo está de pé (sem checar dependências externas)
- `GET /health/ready` — a instância consegue de fato servir tráfego (checa conexão com o Postgres)

## Status atual

- [x] Scaffolding (NestJS + Bun + Docker Compose + health checks)
- [x] Domínio (Money, Wallet, WagerTransaction, WalletLedgerEntry)
- [ ] Persistência (MikroORM + migrations com constraints no schema)
- [ ] Caso de uso central + concorrência por `walletId`
- [ ] Inbox/Outbox + SQS
- [ ] API (controllers, DTOs, autenticação)
- [ ] REFUND / ROLLBACK / `PENDING_REFERENCE` + worker de reprocessamento
- [ ] Observabilidade
- [ ] Testes de integração/concorrência
- [ ] `ARCHITECTURE.md`
