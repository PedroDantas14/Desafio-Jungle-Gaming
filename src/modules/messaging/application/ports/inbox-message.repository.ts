import type { EntityManager } from '@mikro-orm/postgresql';
import type { InboxMessage } from '../../domain/inbox-message';

/** `abstract class`, não `interface` — necessário pro NestJS resolver a injeção. */
export abstract class InboxMessageRepository {
  abstract findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
    em: EntityManager,
  ): Promise<InboxMessage | null>;

  abstract save(message: InboxMessage, em: EntityManager): Promise<void>;
}
