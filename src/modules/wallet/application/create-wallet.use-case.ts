import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { IdGenerator } from '../../../shared/application/id-generator';
import { Wallet } from '../domain/wallet';
import { WalletAlreadyExistsError } from '../domain/wallet.errors';
import { WalletRepository } from './ports/wallet.repository';

export interface CreateWalletCommand {
  playerId: string;
  currency: string;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: { amount: string; currency: string };
  version: number;
}

/**
 * Só abre a wallet com saldo zero. `initialBalance > 0` (seção 9) vira um
 * OPENING processado via `ProcessWagerTransactionUseCase` logo em
 * seguida, pela mesma camada que já sabe creditar/gerar ledger — evita
 * duplicar essa lógica aqui. Orquestração dos dois fica pro controller
 * da Parte 6, dentro da mesma transação.
 */
@Injectable()
export class CreateWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    return this.em.transactional(async (em) => {
      const existing = await this.walletRepository.findByPlayerAndCurrency(
        command.playerId,
        command.currency,
        em,
      );
      if (existing) {
        throw new WalletAlreadyExistsError(command.playerId, command.currency);
      }

      const wallet = Wallet.create({
        id: this.idGenerator.next(),
        playerId: command.playerId,
        currency: command.currency,
      });

      await this.walletRepository.save(wallet, em);

      return this.toResult(wallet);
    });
  }

  private toResult(wallet: Wallet): CreateWalletResult {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: {
        amount: wallet.currentBalance.toString(),
        currency: wallet.currentBalance.currencyCode,
      },
      version: wallet.currentVersion,
    };
  }
}
