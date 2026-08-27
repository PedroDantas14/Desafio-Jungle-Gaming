import { describe, expect, it } from 'bun:test';
import { Money } from '../../../shared/domain/money';
import {
  type CreateWagerTransactionParams,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from './wager-transaction';
import { InvalidStateTransitionError, InvalidWagerTransactionError } from './wagering.errors';

function createBet(overrides: Partial<CreateWagerTransactionParams> = {}): WagerTransaction {
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
    ...overrides,
  });
}

describe('WagerTransaction', () => {
  it('é criada em status Pending', () => {
    expect(createBet().status).toBe(WagerTransactionStatus.Pending);
  });

  it('rejeita um money não positivo', () => {
    expect(() => createBet({ money: Money.zero('BRL') })).toThrow(InvalidWagerTransactionError);
  });

  it('exige referenceExternalTransactionId para REFUND', () => {
    expect(() => createBet({ kind: WagerTransactionKind.Refund })).toThrow(
      InvalidWagerTransactionError,
    );
  });

  it('exige referenceExternalTransactionId para ROLLBACK', () => {
    expect(() => createBet({ kind: WagerTransactionKind.Rollback })).toThrow(
      InvalidWagerTransactionError,
    );
  });

  it('aceita um WIN referenciando opcionalmente o BET de origem', () => {
    const tx = createBet({
      kind: WagerTransactionKind.Win,
      referenceExternalTransactionId: 'transaction-100',
    });
    expect(tx.referenceExternalTransactionId).toBe('transaction-100');
    // Id interno só existe depois que o use case resolve a referência.
    expect(tx.referenceTransactionId).toBeUndefined();
  });

  it('permite OPENING/BET/LOSS sem referência', () => {
    expect(
      createBet({ kind: WagerTransactionKind.Opening }).referenceExternalTransactionId,
    ).toBeUndefined();
    expect(
      createBet({ kind: WagerTransactionKind.Loss }).referenceExternalTransactionId,
    ).toBeUndefined();
  });

  it('resolveReference() define o id interno da transação referenciada', () => {
    const tx = createBet({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'transaction-100',
    });
    tx.resolveReference('internal-tx-100');
    expect(tx.referenceTransactionId).toBe('internal-tx-100');
  });

  it('transiciona Pending -> Processed e registra processedAt', () => {
    const tx = createBet();
    tx.markProcessed();
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.processedAt).toBeInstanceOf(Date);
  });

  it('transiciona Pending -> Rejected registrando o failureCode', () => {
    const tx = createBet();
    tx.markRejected('INSUFFICIENT_BALANCE');
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe('INSUFFICIENT_BALANCE');
  });

  it('transiciona Pending -> PendingReference -> Processed (referência fora de ordem)', () => {
    const tx = createBet({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'transaction-100',
    });
    tx.markPendingReference();
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
    tx.resolveReference('internal-tx-100');
    tx.markProcessed();
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
  });

  it('markPendingReference é idempotente (retry do worker sem a referência ainda ter aparecido)', () => {
    const tx = createBet({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'transaction-100',
    });
    tx.markPendingReference();
    // Um segundo retry ainda sem a referência não é uma transição de
    // verdade (PendingReference -> PendingReference) — não pode lançar.
    expect(() => tx.markPendingReference()).not.toThrow();
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
  });

  it('esgotada a PendingReference, rejeita com REFERENCE_NOT_FOUND', () => {
    const tx = createBet({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'transaction-100',
    });
    tx.markPendingReference();
    tx.markRejected('REFERENCE_NOT_FOUND');
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe('REFERENCE_NOT_FOUND');
  });

  it('rejeita transicionar pra fora de um status terminal', () => {
    const tx = createBet();
    tx.markProcessed();
    expect(() => tx.markRejected('INSUFFICIENT_BALANCE')).toThrow(InvalidStateTransitionError);
  });

  it('rejeita voltar pra Pending a partir de um status terminal', () => {
    const tx = createBet();
    tx.markRejected('INSUFFICIENT_BALANCE');
    expect(() => tx.markProcessed()).toThrow(InvalidStateTransitionError);
  });

  it('reidrata uma transação já em status terminal, com failureCode', () => {
    const tx = WagerTransaction.rehydrate({
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
      status: WagerTransactionStatus.Rejected,
      failureCode: 'INSUFFICIENT_BALANCE',
    });
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe('INSUFFICIENT_BALANCE');
  });
});
