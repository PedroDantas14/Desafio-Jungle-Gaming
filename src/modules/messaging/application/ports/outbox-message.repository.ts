import type { EntityManager } from '@mikro-orm/postgresql';
import type { OutboxMessage } from '../../domain/outbox-message';

/** `abstract class`, não `interface` — necessário pro NestJS resolver a injeção. */
export abstract class OutboxMessageRepository {
  /**
   * `SELECT ... FOR UPDATE SKIP LOCKED` — múltiplos publishers rodando
   * concorrentemente pegam lotes disjuntos de mensagens pendentes, sem
   * bloquear uns aos outros e sem risco de dois workers publicarem a
   * mesma mensagem (seção 11: "múltiplos publishers concorrentes").
   */
  abstract claimDue(limit: number, em: EntityManager): Promise<OutboxMessage[]>;

  abstract save(message: OutboxMessage, em: EntityManager): Promise<void>;
}
