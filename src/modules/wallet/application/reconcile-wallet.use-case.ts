import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../../../shared/domain/money';
import { WalletNotFoundError } from '../domain/wallet.errors';
import { WalletLedgerEntryRepository } from './ports/wallet-ledger-entry.repository';
import { WalletRepository } from './ports/wallet.repository';

export interface ReconcileWalletResult {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

/**
 * `POST /wallets/:id/reconciliation` (seção 9) — recalcula o saldo a
 * partir do ledger, do zero, e compara com o que está armazenado na
 * wallet. Não é lock nem mutação: só leitura + verificação. Cada
 * lançamento já valida sua própria aritmética na criação (`isBalanced()`
 * — seção 6.4), então aqui é só encadear e conferir que o último
 * `balanceAfter` bate com o `balance` atual da wallet.
 */
@Injectable()
export class ReconcileWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepository,
    private readonly walletLedgerEntryRepository: WalletLedgerEntryRepository,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletResult> {
    return this.em.transactional(async (em) => {
      const wallet = await this.walletRepository.findById(walletId, em);
      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }

      const entries = await this.walletLedgerEntryRepository.findAllByWalletId(walletId, em);

      let calculated = Money.zero(wallet.currency);
      for (const entry of entries) {
        // Cada linha já é internamente consistente (garantido na
        // criação); aqui só encadeamos pro saldo final.
        calculated = entry.balanceAfter;
      }

      const stored = wallet.currentBalance;
      const difference = stored.subtract(calculated);

      return {
        walletId: wallet.id,
        storedBalance: stored.toProps(),
        calculatedBalance: calculated.toProps(),
        difference: difference.toProps(),
        consistent: stored.equals(calculated),
        checkedEntries: entries.length,
      };
    });
  }
}
