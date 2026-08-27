import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { BearerAuthGuard } from '../../../shared/interface/bearer-auth.guard';
import { WagerTransactionKind } from '../../wagering/domain/wager-transaction';
import { ProcessWagerTransactionUseCase } from '../../wagering/application/process-wager-transaction.use-case';
import { CreateWalletUseCase } from '../application/create-wallet.use-case';
import { ReconcileWalletUseCase } from '../application/reconcile-wallet.use-case';
import { WalletLedgerEntryRepository } from '../application/ports/wallet-ledger-entry.repository';
import { WalletRepository } from '../application/ports/wallet.repository';
import { CreateWalletRequestDto } from './dto/create-wallet-request.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';

/**
 * `initialBalance`/`reconciliation`/`ledger` cruzam pra dentro de
 * `wagering` (kind OPENING) ou fazem leitura pura — por isso este
 * controller mora no `ApiModule` (importa `WalletModule` +
 * `WageringModule`), não dentro de `WalletModule` — evita o ciclo de
 * módulos que criaria se `WalletModule` dependesse de `WageringModule`
 * (que já depende de `WalletModule`).
 */
@Controller('wallets')
@UseGuards(BearerAuthGuard)
export class WalletController {
  constructor(
    private readonly em: EntityManager,
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly processWagerTransactionUseCase: ProcessWagerTransactionUseCase,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
    private readonly walletRepository: WalletRepository,
    private readonly walletLedgerEntryRepository: WalletLedgerEntryRepository,
  ) {}

  @Post()
  async create(@Body() dto: CreateWalletRequestDto) {
    return this.em.transactional(async (em) => {
      const wallet = await this.createWalletUseCase.processWithinTransaction(
        { playerId: dto.playerId, currency: dto.currency },
        em,
      );

      if (!dto.initialBalance || dto.initialBalance.amount === '0.00') {
        return wallet;
      }

      // initialBalance > 0 gera um OPENING interno na MESMA transação
      // (seção 9) — reusa o caso de uso central em vez de duplicar a
      // lógica de crédito/ledger aqui.
      await this.processWagerTransactionUseCase.processWithinTransaction(
        {
          providerId: 'internal',
          externalTransactionId: `opening:${wallet.id}`,
          idempotencyKey: `internal:opening:${wallet.id}`,
          payloadHash: 'n/a',
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: 'n/a',
          gameId: 'n/a',
          kind: WagerTransactionKind.Opening,
          amount: dto.initialBalance.amount,
          currency: dto.initialBalance.currency,
        },
        em,
      );

      const funded = await this.walletRepository.findById(wallet.id, em);
      return {
        id: funded!.id,
        playerId: funded!.playerId,
        balance: {
          amount: funded!.currentBalance.toString(),
          currency: funded!.currentBalance.currencyCode,
        },
        version: funded!.currentVersion,
      };
    });
  }

  @Get(':walletId')
  async getById(@Param('walletId', ParseUUIDPipe) walletId: string) {
    const wallet = await this.walletRepository.findById(walletId, this.em.fork());
    if (!wallet) {
      throw new NotFoundException(`Wallet "${walletId}" not found.`);
    }
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

  @Get(':walletId/ledger')
  async getLedger(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Query() query: LedgerQueryDto,
  ) {
    const page = await this.walletLedgerEntryRepository.findPage(
      walletId,
      { cursor: query.cursor, limit: query.limit },
      this.em.fork(),
    );

    return {
      entries: page.entries.map((entry) => ({
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toProps(),
        balanceBefore: entry.balanceBefore.toProps(),
        balanceAfter: entry.balanceAfter.toProps(),
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Post(':walletId/reconciliation')
  async reconcile(@Param('walletId', ParseUUIDPipe) walletId: string) {
    return this.reconcileWalletUseCase.execute(walletId);
  }
}
