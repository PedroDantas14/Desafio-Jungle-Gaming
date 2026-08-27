import type { EntityManager } from '@mikro-orm/postgresql';
import { type WagerTransaction, type WagerTransactionKind } from '../../domain/wager-transaction';

/** `abstract class`, não `interface` — ver nota em `id-generator.ts`. */
export abstract class WagerTransactionRepository {
  /** `GET /wagering/transactions/:id` (seção 9). */
  abstract findById(id: string, em: EntityManager): Promise<WagerTransaction | null>;

  /** Base da idempotência (regra 7 da seção 7): replay retorna o resultado original. */
  abstract findByIdempotencyKey(
    idempotencyKey: string,
    em: EntityManager,
  ): Promise<WagerTransaction | null>;

  /** Base da resolução de referência (regra 2 da seção 7) — REFUND/ROLLBACK (Parte 7). */
  abstract findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
    em: EntityManager,
  ): Promise<WagerTransaction | null>;

  /**
   * Regra 4 da seção 7: uma referência não pode ser revertida duas vezes
   * pelo MESMO tipo de operação (um REFUND e um ROLLBACK sobre o mesmo
   * BET são situações distintas, cada um só pode acontecer uma vez).
   */
  abstract existsProcessedReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
    em: EntityManager,
  ): Promise<boolean>;

  /**
   * Lote de transações `PendingReference`, mais antiga primeiro — usado
   * pelo `PendingReferenceReprocessorWorker` (seção 7.1).
   */
  abstract findPendingReferenceBatch(limit: number, em: EntityManager): Promise<WagerTransaction[]>;

  /** Insere se for nova, atualiza (status/referência/failureCode/processedAt) se já existir. */
  abstract save(transaction: WagerTransaction, em: EntityManager): Promise<void>;
}
