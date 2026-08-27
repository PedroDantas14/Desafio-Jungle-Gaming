import { describe, expect, it } from 'bun:test';
import { Money } from '../../../shared/domain/money';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction';
import { WagerTransactionMapper } from './wager-transaction.mapper';

function createBet(): WagerTransaction {
  return WagerTransaction.create({
    id: 't1',
    providerId: 'provider-a',
    externalTransactionId: 'transaction-123',
    idempotencyKey: 'provider-a:transaction-123',
    payloadHash: 'hash-1',
    walletId: 'w1',
    playerId: 'p1',
    roundId: 'round-987',
    gameId: 'fortune-chimp',
    kind: WagerTransactionKind.Bet,
    money: Money.fromString('80.00', 'BRL'),
  });
}

describe('WagerTransactionMapper', () => {
  it('faz round-trip domínio -> linha ORM -> domínio (status Pending)', () => {
    const tx = createBet();
    const row = WagerTransactionMapper.toNewOrmEntity(tx);
    const rehydrated = WagerTransactionMapper.toDomain(row);

    expect(rehydrated.id).toBe(tx.id);
    expect(rehydrated.providerId).toBe(tx.providerId);
    expect(rehydrated.externalTransactionId).toBe(tx.externalTransactionId);
    expect(rehydrated.money.equals(tx.money)).toBe(true);
    expect(rehydrated.status).toBe(WagerTransactionStatus.Pending);
  });

  it('preserva failureCode, referenceTransactionId e processedAt depois de uma rejeição', () => {
    const tx = WagerTransaction.create({
      id: 't2',
      providerId: 'provider-a',
      externalTransactionId: 'transaction-124',
      idempotencyKey: 'provider-a:transaction-124',
      payloadHash: 'hash-2',
      walletId: 'w1',
      playerId: 'p1',
      roundId: 'round-987',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.fromString('80.00', 'BRL'),
      referenceExternalTransactionId: 'transaction-123',
    });
    tx.resolveReference('internal-t1');
    tx.markRejected('REVERSAL_WOULD_OVERDRAW');

    const row = WagerTransactionMapper.toNewOrmEntity(tx);
    const rehydrated = WagerTransactionMapper.toDomain(row);

    expect(rehydrated.status).toBe(WagerTransactionStatus.Rejected);
    expect(rehydrated.failureCode).toBe('REVERSAL_WOULD_OVERDRAW');
    expect(rehydrated.referenceTransactionId).toBe('internal-t1');
    expect(rehydrated.referenceExternalTransactionId).toBe('transaction-123');
    expect(rehydrated.processedAt).toBeInstanceOf(Date);
  });

  it('applyToExistingOrmEntity só toca campos mutáveis', () => {
    const tx = createBet();
    const row = WagerTransactionMapper.toNewOrmEntity(tx);

    tx.markProcessed();
    WagerTransactionMapper.applyToExistingOrmEntity(tx, row);

    expect(row.status).toBe(WagerTransactionStatus.Processed);
    expect(row.processedAt).toBeInstanceOf(Date);
    expect(row.providerId).toBe(tx.providerId); // inalterado
  });
});
