import { Money } from '../../../shared/domain/money';
import { InvalidStateTransitionError, InvalidWagerTransactionError } from './wagering.errors';

export enum WagerTransactionKind {
  Opening = 'OPENING', // interno: crédito de abertura da wallet
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING', // aceita, ainda não aplicada
  PendingReference = 'PENDING_REFERENCE', // aguardando a transação referenciada
  Processed = 'PROCESSED', // aplicada (terminal)
  Rejected = 'REJECTED', // violação de regra de negócio (terminal)
  Failed = 'FAILED', // erro permanente de infraestrutura (terminal, auditável)
}

/**
 * Taxonomia de códigos de falha (seção 7.2 do desafio: toda rejeição
 * precisa carregar um `failureCode` estável e legível por máquina — "a
 * taxonomia é sua"). Esta é a nossa, documentada e ampliada conforme as
 * regras de negócio da seção 7 forem implementadas nos use cases (Parte 4).
 */
export type FailureCode =
  // BET rejeitado por saldo insuficiente.
  | 'INSUFFICIENT_BALANCE'
  // REFUND/ROLLBACK que deixaria o saldo negativo — regra 9 da seção 7
  // exige um código DISTINTO de INSUFFICIENT_BALANCE: são situações
  // operacionalmente diferentes mesmo sendo "sem saldo" nos dois casos.
  | 'REVERSAL_WOULD_OVERDRAW'
  // A referência (providerId + referenceExternalTransactionId) não existe,
  // inclusive depois de esgotar as tentativas de PENDING_REFERENCE (7.1).
  | 'REFERENCE_NOT_FOUND'
  // Referência existe mas não pertence ao mesmo provider/player/wallet/
  // moeda/rodada (regra 2 da seção 7).
  | 'REFERENCE_OUT_OF_SCOPE'
  // REFUND referenciando algo que não é BET, ou ROLLBACK referenciando
  // algo fora de BET/WIN/REFUND (regra 3 da seção 7).
  | 'REFERENCE_KIND_NOT_ALLOWED'
  // Referência já revertida uma vez pelo mesmo tipo de operação (regra 4).
  | 'REFERENCE_ALREADY_REVERSED'
  // Valor do REFUND/ROLLBACK diferente do valor da referência (regra 5).
  | 'REFERENCE_AMOUNT_MISMATCH';

// REFUND credita de volta um BET processado específico; ROLLBACK reverte
// uma transação processada específica — ambos não fazem sentido sem saber
// a qual transação do provider se referem.
const KINDS_REQUIRING_REFERENCE: ReadonlySet<WagerTransactionKind> = new Set([
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);

// Processed/Rejected/Failed são terminais — nada transiciona pra fora deles.
const ALLOWED_TRANSITIONS: Record<WagerTransactionStatus, ReadonlySet<WagerTransactionStatus>> = {
  [WagerTransactionStatus.Pending]: new Set([
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
    WagerTransactionStatus.PendingReference,
  ]),
  [WagerTransactionStatus.PendingReference]: new Set([
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ]),
  [WagerTransactionStatus.Processed]: new Set(),
  [WagerTransactionStatus.Rejected]: new Set(),
  [WagerTransactionStatus.Failed]: new Set(),
};

export interface CreateWagerTransactionParams {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  // O que chega no request (seção 9) — o id interno da transação
  // referenciada só é conhecido depois, via resolveReference().
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface RehydrateWagerTransactionParams extends CreateWagerTransactionParams {
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

export class WagerTransaction {
  private _status: WagerTransactionStatus;
  private _referenceTransactionId?: string;
  private _failureCode?: FailureCode;
  private _processedAt?: Date;

  private constructor(
    readonly id: string,
    readonly providerId: string,
    readonly externalTransactionId: string,
    readonly idempotencyKey: string,
    readonly payloadHash: string,
    readonly walletId: string,
    readonly playerId: string,
    readonly roundId: string,
    readonly gameId: string,
    readonly kind: WagerTransactionKind,
    readonly money: Money,
    readonly referenceExternalTransactionId: string | undefined,
    readonly createdAt: Date,
    status: WagerTransactionStatus,
    referenceTransactionId?: string,
    failureCode?: FailureCode,
    processedAt?: Date,
  ) {
    this._status = status;
    this._referenceTransactionId = referenceTransactionId;
    this._failureCode = failureCode;
    this._processedAt = processedAt;
  }

  /** Transação nova, sempre começa a vida como Pending. */
  static create(params: CreateWagerTransactionParams): WagerTransaction {
    if (!params.money.isPositive()) {
      throw new InvalidWagerTransactionError('money must be positive.');
    }

    if (KINDS_REQUIRING_REFERENCE.has(params.kind) && !params.referenceExternalTransactionId) {
      throw new InvalidWagerTransactionError(
        `${params.kind} requires a referenceExternalTransactionId.`,
      );
    }

    return new WagerTransaction(
      params.id,
      params.providerId,
      params.externalTransactionId,
      params.idempotencyKey,
      params.payloadHash,
      params.walletId,
      params.playerId,
      params.roundId,
      params.gameId,
      params.kind,
      params.money,
      params.referenceExternalTransactionId,
      params.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  /**
   * Reidrata uma transação já persistida, no status em que estiver. Não
   * revalida regra de transição nenhuma — só reconstrói estado (seção 6.0
   * do desafio).
   */
  static rehydrate(params: RehydrateWagerTransactionParams): WagerTransaction {
    return new WagerTransaction(
      params.id,
      params.providerId,
      params.externalTransactionId,
      params.idempotencyKey,
      params.payloadHash,
      params.walletId,
      params.playerId,
      params.roundId,
      params.gameId,
      params.kind,
      params.money,
      params.referenceExternalTransactionId,
      params.createdAt ?? new Date(),
      params.status,
      params.referenceTransactionId,
      params.failureCode,
      params.processedAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  /** Id interno da transação referenciada, só depois de resolveReference(). */
  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  /**
   * Chamado pelo use case (Parte 4) depois de resolver
   * (providerId, referenceExternalTransactionId) pro id interno da
   * transação referenciada — tipicamente ao sair de PendingReference.
   */
  resolveReference(transactionId: string): void {
    this._referenceTransactionId = transactionId;
  }

  markProcessed(): void {
    this.transitionTo(WagerTransactionStatus.Processed);
    this._processedAt = new Date();
  }

  markRejected(failureCode: FailureCode): void {
    this.transitionTo(WagerTransactionStatus.Rejected);
    this._failureCode = failureCode;
    this._processedAt = new Date();
  }

  markFailed(failureCode?: FailureCode): void {
    this.transitionTo(WagerTransactionStatus.Failed);
    this._failureCode = failureCode;
    this._processedAt = new Date();
  }

  markPendingReference(): void {
    this.transitionTo(WagerTransactionStatus.PendingReference);
  }

  private transitionTo(next: WagerTransactionStatus): void {
    const allowed = ALLOWED_TRANSITIONS[this._status];
    if (!allowed.has(next)) {
      throw new InvalidStateTransitionError(this.id, this._status, next);
    }
    this._status = next;
  }
}
