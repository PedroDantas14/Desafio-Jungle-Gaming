import { describe, expect, it } from 'bun:test';
import { IntegrationEvent } from '../../../shared/domain/integration-event';
import { OutboxMessage } from './outbox-message';

class TestEvent extends IntegrationEvent<{ foo: string }> {
  readonly eventType = 'TestEvent';
  readonly version = 1;

  static create(): TestEvent {
    return new TestEvent('event-1', 'aggregate-1', 'correlation-1', new Date(), { foo: 'bar' });
  }
}

describe('OutboxMessage', () => {
  it('enqueue() deriva aggregateId/eventType do evento e começa com 0 tentativas', () => {
    const message = OutboxMessage.enqueue({ id: 'outbox-1', event: TestEvent.create() });

    expect(message.aggregateId).toBe('aggregate-1');
    expect(message.eventType).toBe('TestEvent');
    expect(message.payload.eventId).toBe('event-1');
    expect(message.payload.data).toEqual({ foo: 'bar' });
    expect(message.attempts).toBe(0);
    expect(message.isPublished).toBe(false);
  });

  it('markPublished() marca publicado', () => {
    const message = OutboxMessage.enqueue({ id: 'outbox-1', event: TestEvent.create() });
    const at = new Date('2026-08-27T00:00:00.000Z');
    message.markPublished(at);
    expect(message.isPublished).toBe(true);
    expect(message.publishedAt).toBe(at);
  });

  it('scheduleRetry() incrementa tentativas e aplica backoff exponencial crescente', () => {
    const message = OutboxMessage.enqueue({ id: 'outbox-1', event: TestEvent.create() });
    const now = new Date('2026-08-27T00:00:00.000Z');

    message.scheduleRetry(now);
    expect(message.attempts).toBe(1);
    const firstDelay = message.nextAttemptAt.getTime() - now.getTime();

    message.scheduleRetry(now);
    expect(message.attempts).toBe(2);
    const secondDelay = message.nextAttemptAt.getTime() - now.getTime();

    expect(secondDelay).toBeGreaterThan(firstDelay);
  });

  it('scheduleRetry() satura num teto máximo, não cresce pra sempre', () => {
    const message = OutboxMessage.enqueue({ id: 'outbox-1', event: TestEvent.create() });
    const now = new Date('2026-08-27T00:00:00.000Z');

    for (let i = 0; i < 20; i += 1) {
      message.scheduleRetry(now);
    }

    const delay = message.nextAttemptAt.getTime() - now.getTime();
    expect(delay).toBe(5 * 60 * 1_000);
  });
});
