import { describe, expect, it } from 'bun:test';
import { InboxMessage } from './inbox-message';

describe('InboxMessage', () => {
  it('recebe uma mensagem nova como não processada', () => {
    const message = InboxMessage.receive({
      messageId: 'm1',
      consumerName: 'wager-transactions-consumer',
      payloadHash: 'hash-1',
    });
    expect(message.isProcessed).toBe(false);
    expect(message.processedAt).toBeUndefined();
  });

  it('markProcessed() registra a conclusão', () => {
    const message = InboxMessage.receive({
      messageId: 'm1',
      consumerName: 'wager-transactions-consumer',
      payloadHash: 'hash-1',
    });
    const at = new Date('2026-08-27T00:00:00.000Z');
    message.markProcessed(at);
    expect(message.isProcessed).toBe(true);
    expect(message.processedAt).toBe(at);
  });

  it('reidrata preservando o status de processada', () => {
    const message = InboxMessage.rehydrate({
      messageId: 'm1',
      consumerName: 'wager-transactions-consumer',
      payloadHash: 'hash-1',
      receivedAt: new Date('2026-08-27T00:00:00.000Z'),
      processedAt: new Date('2026-08-27T00:00:05.000Z'),
    });
    expect(message.isProcessed).toBe(true);
  });
});
