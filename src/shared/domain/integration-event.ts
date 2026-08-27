/** Envelope estável serializado (seção 11 do desafio). */
export interface IntegrationEventEnvelope<TData> {
  eventId: string;
  eventType: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  version: number;
  data: TData;
}

/** Correlação entre eventos — o mesmo `correlationId` amarra tudo que uma requisição originou. */
export interface IntegrationEventContext {
  correlationId: string;
  causationId?: string;
}

/**
 * Classe base pra todo evento de integração publicado via outbox.
 * Subclasses concretas (`WalletBalanceChangedEvent`, etc.) só precisam
 * declarar `eventType`/`version` e um factory `from(...)` que monta
 * `data` a partir de agregados de domínio.
 *
 * `toJSON()` serializa no formato estável exigido pela seção 11 — é isso
 * que vira o payload publicado no SQS via outbox, nunca a instância do
 * evento diretamente (`data` carrega `MoneyProps`, nunca `Money`).
 */
export abstract class IntegrationEvent<TData> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  protected constructor(
    readonly eventId: string,
    readonly aggregateId: string,
    readonly correlationId: string,
    readonly occurredAt: Date,
    readonly data: TData,
    readonly causationId?: string,
  ) {}

  toJSON(): IntegrationEventEnvelope<TData> {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data,
    };
  }
}
