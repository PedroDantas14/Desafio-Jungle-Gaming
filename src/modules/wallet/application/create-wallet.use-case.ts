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
 * duplicar essa lógica aqui. Orquestração dos dois fica no
 * `WalletController` (Parte 6), usando `processWithinTransaction` dos
 * dois use cases dentro de uma única transação.
 */
@Injectable()
export class CreateWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    return this.em.transactional((em) => this.processWithinTransaction(command, em));
  }

  /** Mesma lógica de `execute()`, dentro de uma transação que o chamador já abriu. */
  async processWithinTransaction(
    command: CreateWalletCommand,
    em: EntityManager,
  ): Promise<CreateWalletResult> {
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

    // Flush explícito: como os agregados se referenciam só por FK escalar
    // (sem relação @ManyToOne do MikroORM — ver wallet.orm-entity.ts),
    // o ORM não sabe que um insert de WagerTransaction feito logo em
    // seguida, na MESMA transação composta (ex: POST /wallets com
    // initialBalance orquestrando este use case + ProcessWagerTransactionUseCase),
    // depende dessa wallet existir primeiro. Sem isso, o flush final da
    // transação pode mandar os inserts fora de ordem e o Postgres rejeita
    // a FK (achado testando o endpoint de verdade, não só em unit test).
    await em.flush();

    return this.toResult(wallet);
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
