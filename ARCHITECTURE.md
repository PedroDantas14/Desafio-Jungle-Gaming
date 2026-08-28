# Arquitetura

Decisões, trade-offs e limitações do processador de transações financeiras. Setup e comandos ficam no [`README.md`](./README.md); o enunciado original do desafio (fonte da verdade da spec) está em https://github.com/junglegaming/backend-challenge.

## Visão geral

Três módulos de domínio (`wallet`, `wagering`, `messaging`) + um `shared` pro kernel comum. Cada módulo segue `domain/` → `application/` → `infrastructure/` → `interface/`:

- **`domain/`** — entidades e value objects puros, sem dependência de framework/banco. Construtor `private`/`protected` + factories estáticas: `create()` pra objeto novo (valida invariantes), `rehydrate()` pra reconstruir a partir do banco (não revalida transição nenhuma, só reconstrói estado já persistido).
- **`application/`** — use cases e *ports* (`abstract class`, nunca `interface` — ver "Decisões técnicas menores" abaixo).
- **`infrastructure/`** — implementações concretas dos ports (MikroORM, SQS), workers em background.
- **`interface/`** — controllers HTTP, DTOs, guards.

Cada aggregate root referencia os outros só por **id escalar** (FK no banco, nunca relação `@ManyToOne`/`@OneToMany` do ORM) — preserva o limite de aggregate do DDD e evita que o ORM tome decisões de fetch/flush por conta própria através de um aggregate.

## Modelo de domínio

- **`Money`**: imutável, `bigint` de centavos internamente — nunca `number`/`float`. A única fronteira com decimal-como-texto é `fromString()`/`toString()`.
- **`Wallet`** (aggregate root): 1 por `(playerId, currency)`, saldo (`Money`) + `version`, nunca negativo.
- **`WagerTransaction`**: referencia outra transação em **duas etapas** — `referenceExternalTransactionId` (o que chega no request, id do provider) é resolvido depois via lookup `(providerId, referenceExternalTransactionId)` pro `referenceTransactionId` interno.
- **`WalletLedgerEntry`**: imutabilidade **estrutural**, não por convenção — sem métodos de transição, e reforçada por um trigger no banco que rejeita `UPDATE`/`DELETE` (`wallet_ledger_entries_immutable`, ver migration). No máximo 1 lançamento por wallet por transação; operação sem impacto financeiro (`LOSS`) não gera lançamento.
- **`InboxMessage`/`OutboxMessage`**: dedup de entrada (`consumerName, messageId`) e fila de publicação transacional, respectivamente — ver seção Mensageria.

## Concorrência (seção 8)

**Estratégia escolhida: lock pessimista** (`SELECT ... FOR UPDATE` na linha da wallet, em `ProcessWagerTransactionUseCase.lockWallet()`), não optimistic locking com retry.

**Justificativa**: processar apostas contra uma wallet é inerentemente sequencial — não há ganho real em deixar duas requisições da mesma wallet avançarem "em paralelo" só pra uma refazer o trabalho depois. O lock do Postgres funciona igual não importa quantas instâncias da aplicação existem (garantia real por trás do requisito de 3+ instâncias, sem estado compartilhado em memória), e a janela do lock é curta (leitura + escrita local, sem I/O externo no meio da transação).

**Fluxo**: lock da wallet → checagem de idempotência (**depois** do lock, de propósito) → checagem de payload conflitante → aplica efeito → persiste tudo (wallet + ledger + wager transaction + outbox) na mesma transação SQL.

A checagem de idempotência é feita **depois** do lock deliberadamente: checar antes cria uma corrida real onde duas chamadas com a mesma `idempotencyKey` passam juntas pelo "não existe" e a segunda bate de frente no `UNIQUE` constraint como erro cru em vez de replay limpo. Sob o lock da wallet, isso é estruturalmente impossível.

## Idempotência

- `idempotencyKey` é a fonte da verdade (header HTTP, ou derivada como `providerId:externalTransactionId` quando ausente — ver `WageringController`).
- Replay de uma `idempotencyKey` já processada devolve o resultado original sem reprocessar (regra 7, seção 7). Pra uma transação `PROCESSED`, o saldo devolvido vem do `balanceAfter` do próprio ledger; pra `REJECTED`, do saldo atual da wallet (nada mudou).
- **Payload conflitante é erro, não replay** (seção 6.3): a mesma `idempotencyKey` com um corpo diferente indica que o provider reusou a chave por engano — `WagerTransaction.matchesPayload()` é checado antes de qualquer replay, e a divergência vira `IdempotencyPayloadConflictError` (HTTP 409), nunca um replay silencioso do resultado antigo.
- `payloadHash` é um SHA-256 de um **JSON canônico** (chaves ordenadas recursivamente) de um subconjunto explícito de campos de negócio — nunca do objeto de request/mensagem inteiro (`canonicalPayloadHash`, `src/shared/infrastructure/payload-hash.ts`). Usado nos **dois** pontos de entrada (HTTP e SQS) com o mesmo algoritmo — a mesma operação de negócio produz o mesmo hash não importa a porta.

## Mensageria (Inbox/Outbox + SQS, seções 10/11)

**Outbox**: eventos são enfileirados na tabela `outbox_messages` **na mesma transação SQL** que persiste a mudança de negócio — nunca publicados diretamente. `OutboxPublisherWorker` roda em loop (`onModuleInit`), reivindica lotes via `SELECT ... FOR UPDATE SKIP LOCKED` (múltiplas instâncias pegam lotes disjuntos, sem se bloquear) e publica em `integration-events.fifo` com `MessageDeduplicationId = eventId`.

**Trade-off aceito conscientemente**: se o processo morre exatamente entre o `SendMessageCommand` ter sucesso e o commit que marca a mensagem como publicada, ela é reenviada na próxima rodada — duplicação **limitada** (não indefinida, que é o que a spec proíbe). A fila FIFO com dedup por `eventId` absorve boa parte disso de graça.

**Inbox**: o consumidor de `wager-transactions.fifo` dedupe por `(consumerName, messageId)` — reusa o **mesmo** use case da entrada HTTP via `processWithinTransaction(cmd, em)`, não `execute()`, pra que inbox + mutação de wallet + ledger + outbox fiquem na mesma transação. Ack (delete da mensagem) só acontece **depois** do commit; erro de negócio (`DomainError`) é terminal e confirma na hora; erro transitório não apaga — o visibility timeout expira e o SQS reentrega sozinho.

**DLQ**: não é reimplementada — é a `RedrivePolicy` da fila (`maxReceiveCount: 5`, configurada em `SqsQueueRegistry`) que move a mensagem sozinha depois de N tentativas. O consumer só decide apagar (erro de negócio) ou não apagar (erro transitório); a métrica `sqs_dlq_messages` é um *gauge* amostrado periodicamente (`DlqDepthSampler`) porque o app nunca "vê" a mensagem indo pra DLQ diretamente.

## `REFUND`/`ROLLBACK`/`PENDING_REFERENCE` (seção 7)

`applyReversal` resolve a referência e aplica as regras 1-9 da seção 7 em sequência: referência ausente vira `PendingReference` (não erro) → escopo (player/wallet/rodada/moeda) → status `PROCESSED` da referência → kind permitido (`REFUND`→`BET`; `ROLLBACK`→`BET`/`WIN`/`REFUND`) → valor idêntico → dupla-reversão (`existsProcessedReversal`, por `(referência, kind)` — um `REFUND` e um `ROLLBACK` sobre o mesmo `BET` são permitidos, são situações distintas).

`PendingReferenceReprocessorWorker`: backoff exponencial **no próprio ritmo de polling** (2s→30s, não por transação) — decisão deliberada porque o worker frequentemente não tem nada a fazer (a referência pode demorar minutos), então bater no banco a cada 2s indefinidamente é desperdício. TTL de espera: 10 minutos fixos, escolhido em vez de contador de tentativas porque o shape de `WagerTransaction` dado pela spec (seção 6.3) não tem campo de tentativas — a regra 8 permite "limite de tentativas OU TTL".

## Observabilidade (seção 12)

- **Logs**: `JsonLogger` substitui o `ConsoleLogger` padrão do Nest — uma linha JSON por evento. Eventos de domínio carregam só identificadores (`transactionId`/`walletId`/`providerId`/`correlationId`) — nunca valor monetário nem payload bruto de mensagem SQS.
- **Métricas**: `MetricsService` (`prom-client`, `Registry` próprio por instância) expostas em `GET /metrics` — transações por status/kind, duplicatas (idempotência **e** redelivery de mensagem — dois eixos diferentes, mesmo contador), retries de `PENDING_REFERENCE`, profundidade da DLQ, tempo de lock, atraso do outbox, latência fim-a-fim, e divergências de reconciliação (`wallet_reconciliation_divergences_total`).
- **Health checks**: liveness nunca checa dependência externa (um Postgres instável não pode derrubar o processo via orquestrador); readiness checa Postgres **e** SQS.

## Autenticação (seção 2 — não vale pontos)

`BearerAuthGuard` valida contra o JWKS de um IdP externo (nunca emite token). Decisão de escopo: sem `AUTH_JWKS_URI` configurado, o guard fica desabilitado (loga aviso, deixa passar) — autenticação não deve competir por tempo com correção financeira/concorrência/idempotência, que são o que vale pontos.

## Testes (seção 13)

Unidade prova regra de domínio isolada; integração e concorrência batem em Postgres + LocalStack **reais** (nunca mocks completos — é falha eliminatória da spec). Destaques de decisão:

- **Timeouts maiores em alguns testes**: `WaitTimeSeconds` do SQS é fixo em 5s em produção; testes que fazem 2+ `pollOnce()` (redelivery, DLQ) precisam de timeout de teste maior que o padrão de 5s do `bun:test`.
- **Crash "depois do commit, antes do ack"** é provado com um proxy que intercepta só o `DeleteMessageCommand` do `SQSClient` real e falha uma vez — tudo o resto (receive, processamento, delete na 2ª tentativa) bate no LocalStack de verdade. Não é mock da infra inteira.
- **DLQ real**: um proxy que faz *todo* delete falhar, seis tentativas com visibility timeout curto (parametrizável via `pollOnce(visibilityTimeoutSeconds)` — parâmetro de **método**, não de construtor, porque um `number` de construtor sem token quebraria a resolução de DI do Nest em produção), e confere lendo direto da fila `wager-transactions-dlq.fifo`.
- **Constraints do schema** (`schema-constraints.integration.test.ts`): ataca UNIQUE/CHECK/o trigger de imutabilidade via SQL cru, contornando a aplicação — prova que a garantia é do Postgres, não só disciplina de código.
- **Backlog global do outbox**: como o outbox não é resetado entre execuções da suíte, o teste de publishers concorrentes drena o backlog global uma vez no `beforeAll` antes de medir — senão contagens exatas ficam não-determinísticas.
- **Invariante final** (`wallet.balance == saldo reconstruído pelo ledger`) reusa `ReconcileWalletUseCase` em vez de reimplementar a reconstrução via SQL cru.

## Decisões técnicas menores

- **Ports são `abstract class`, nunca `interface`**: uma interface não tem identidade em runtime, e um `@Injectable()` do NestJS com parâmetro tipado como interface pura não resolve a injeção de dependência (emite `Object` no metadata do decorator). Bug real pego durante a implementação, não só teórico.
- **`Money` como `@Embeddable`** (`p.bigint()`, `mode: 'bigint'`) mapeia pra `bigint` nativo do JS — validado empiricamente contra o Postgres real, não por suposição da documentação do MikroORM.
- **Nenhuma constraint real fica declarada nas entidades** (`UNIQUE` composto, `CHECK`, FKs, o trigger de imutabilidade) — tudo escrito à mão em SQL puro na migration, mais auditável que depender da sintaxe de constraint do `defineEntity`. Trade-off: `migration:create` num diff futuro não reconhece essas constraints; revisar manualmente qualquer migration gerada depois da inicial.
- **Composição de use cases na mesma transação** (ex: `POST /wallets` com `initialBalance` orquestra `CreateWalletUseCase` + `ProcessWagerTransactionUseCase` no controller) exige `await em.flush()` explícito ao fim de cada `processWithinTransaction` — agregados com FK escalar (sem relação do MikroORM) não têm ordenação de flush garantida entre si.
- **Transições de estado "idempotentes" não são transições de verdade**: `ALLOWED_TRANSITIONS` nunca lista um status pra ele mesmo, então qualquer método de domínio que pode ser chamado de novo sobre um estado que já está lá (`markPendingReference()` num retry sem sucesso) precisa de early-return explícito, senão lança erro numa situação que é logicamente um no-op.

## Limitações conhecidas / dívida técnica

- **`UNIQUE (reference_transaction_id, kind) WHERE status='PROCESSED'` não existe no banco** — a garantia de "referência revertida no máximo uma vez por kind" (regra 4, seção 7) hoje só é aplicada em nível de aplicação (`existsProcessedReversal`, sob o lock da wallet). Seguro na prática porque todo write passa por esse lock, mas seria defesa em profundidade se fosse constraint também.
- **Sem OpenTelemetry/dashboard** — a spec marca isso como diferencial opcional, não obrigatório; não implementado.
- **Sem teste de carga formal** (`test:load`) — diferencial opcional da seção 14, não implementado.
- **Autenticação não é validada por padrão** (decisão de escopo documentada acima) — funcional mas desligada sem `AUTH_JWKS_URI`.
- **`--scale app=3` do Docker Compose precisa de ajuste de porta/load balancer** pra acesso externo com múltiplas réplicas simultâneas (ver README) — a correção sob concorrência em si não depende disso, é só uma limitação de exposição de rede do compose local.
