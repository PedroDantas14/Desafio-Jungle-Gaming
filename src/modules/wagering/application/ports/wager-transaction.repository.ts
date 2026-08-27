import type { EntityManager } from '@mikro-orm/postgresql';
import { type WagerTransaction } from '../../domain/wager-transaction';

/** `abstract class`, não `interface` — ver nota em `id-generator.ts`. */
export abstract class WagerTransactionRepository {
  /** Base da idempotência (regra 7 da seção 7): replay retorna o resultado original. */
  abstract findByIdempotencyKey(
    idempotencyKey: string,
    em: EntityManager,
  ): Promise<WagerTransaction | null>;

  /** Base da resolução de referência (regra 2 da seção 7) — usado a partir da Parte 7 (REFUND/ROLLBACK). */
  abstract findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
    em: EntityManager,
  ): Promise<WagerTransaction | null>;

  /** Insere se for nova, atualiza (status/referência/failureCode/processedAt) se já existir. */
  abstract save(transaction: WagerTransaction, em: EntityManager): Promise<void>;
}
