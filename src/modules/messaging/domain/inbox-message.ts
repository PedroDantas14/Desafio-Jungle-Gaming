export interface ReceiveInboxMessageParams {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt?: Date;
}

export interface RehydrateInboxMessageParams extends ReceiveInboxMessageParams {
  processedAt?: Date;
}

/**
 * Registro de deduplicação de mensagem consumida (seção 6.5). Chave
 * natural de dedup é `(consumerName, messageId)` — reforçada por UNIQUE
 * na migration, não só aqui. Um consumidor confere se já existe uma
 * linha antes de processar; se existir e estiver `processed`, é replay
 * — ack e ignora, nunca reprocessa efeito.
 */
export class InboxMessage {
  private _processedAt?: Date;

  private constructor(
    readonly messageId: string,
    readonly consumerName: string,
    readonly payloadHash: string,
    readonly receivedAt: Date,
    processedAt?: Date,
  ) {
    this._processedAt = processedAt;
  }

  static receive(params: ReceiveInboxMessageParams): InboxMessage {
    return new InboxMessage(
      params.messageId,
      params.consumerName,
      params.payloadHash,
      params.receivedAt ?? new Date(),
    );
  }

  static rehydrate(params: RehydrateInboxMessageParams): InboxMessage {
    return new InboxMessage(
      params.messageId,
      params.consumerName,
      params.payloadHash,
      params.receivedAt ?? new Date(),
      params.processedAt,
    );
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date = new Date()): void {
    this._processedAt = at;
  }
}
