import { describe, expect, it } from 'bun:test';
import { CurrencyMismatchError } from '../../../shared/domain/money.errors';
import { Money } from '../../../shared/domain/money';
import { Wallet } from './wallet';
import { InsufficientBalanceError } from './wallet.errors';

describe('Wallet', () => {
  it('cria com saldo zero e version 1 (seção 6.2: version inicia em 1 na criação)', () => {
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    expect(wallet.currentBalance.toString()).toBe('0.00');
    expect(wallet.currentVersion).toBe(1);
  });

  it('credita o saldo e avança a version', () => {
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));
    expect(wallet.currentBalance.toString()).toBe('100.00');
    expect(wallet.currentVersion).toBe(2);
  });

  it('debita o saldo quando há fundos suficientes', () => {
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));
    wallet.debit(Money.fromString('80.00', 'BRL'));
    expect(wallet.currentBalance.toString()).toBe('20.00');
    expect(wallet.currentVersion).toBe(3);
  });

  it('rejeita um débito que deixaria o saldo negativo, sem mutar estado', () => {
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));

    expect(() => wallet.debit(Money.fromString('100.01', 'BRL'))).toThrow(InsufficientBalanceError);
    // Uma tentativa rejeitada não pode alterar balance nem version.
    expect(wallet.currentBalance.toString()).toBe('100.00');
    expect(wallet.currentVersion).toBe(2);
  });

  it('permite um débito que zera exatamente o saldo', () => {
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));
    wallet.debit(Money.fromString('100.00', 'BRL'));
    expect(wallet.currentBalance.toString()).toBe('0.00');
  });

  it('documenta o cenário obrigatório de concorrência (seção 8) a nível de domínio', () => {
    // Duas apostas de 80 BRL sobre um saldo de 100 BRL: aplicadas em
    // sequência (como uma estratégia de lock correta forçaria na camada de
    // banco, na Parte 4), exatamente uma tem sucesso e o saldo final é 20
    // BRL. Este teste só prova que o invariante de domínio está correto —
    // não exercita concorrência real, que depende da camada de persistência.
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));

    const bet = Money.fromString('80.00', 'BRL');
    wallet.debit(bet);

    expect(() => wallet.debit(bet)).toThrow(InsufficientBalanceError);
    expect(wallet.currentBalance.toString()).toBe('20.00');
    expect(wallet.currentVersion).toBe(3);
  });

  it('rejeita operações entre moedas diferentes', () => {
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    expect(() => wallet.credit(Money.fromString('10.00', 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('reidrata a partir de estado persistido', () => {
    const wallet = Wallet.rehydrate({
      id: 'w1',
      playerId: 'p1',
      balance: Money.fromString('42.00', 'BRL'),
      version: 7,
    });
    expect(wallet.currentBalance.toString()).toBe('42.00');
    expect(wallet.currentVersion).toBe(7);
  });
});
