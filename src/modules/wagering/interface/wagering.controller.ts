import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { BearerAuthGuard } from '../../../shared/interface/bearer-auth.guard';
import { WagerTransactionRepository } from '../application/ports/wager-transaction.repository';
import { ProcessWagerTransactionUseCase } from '../application/process-wager-transaction.use-case';
import { ProcessWagerTransactionRequestDto } from './dto/process-wager-transaction-request.dto';

function toTransactionView(tx: {
  id: string;
  status: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: { toProps(): { amount: string; currency: string } };
  failureCode?: string;
  processedAt?: Date;
  createdAt: Date;
}) {
  return {
    transactionId: tx.id,
    status: tx.status,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    money: tx.money.toProps(),
    failureCode: tx.failureCode,
    processedAt: tx.processedAt?.toISOString(),
    createdAt: tx.createdAt.toISOString(),
  };
}

@Controller()
@UseGuards(BearerAuthGuard)
export class WageringController {
  constructor(
    private readonly em: EntityManager,
    private readonly processWagerTransactionUseCase: ProcessWagerTransactionUseCase,
    private readonly wagerTransactionRepository: WagerTransactionRepository,
  ) {}

  @Post('wagering/transactions')
  async process(
    @Body() dto: ProcessWagerTransactionRequestDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ) {
    // Seção 9: o header é a fonte oficial da chave; "provider:externalId"
    // é o formato mostrado no exemplo, então cai pra isso se o header
    // vier ausente (facilita testar sem montar o header na mão).
    const idempotencyKey = idempotencyKeyHeader ?? `${dto.providerId}:${dto.externalTransactionId}`;

    if (!idempotencyKey) {
      throw new BadRequestException(
        'Idempotency-Key header or providerId+externalTransactionId is required.',
      );
    }

    return this.processWagerTransactionUseCase.execute({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      idempotencyKey,
      payloadHash: JSON.stringify(dto),
      walletId: dto.walletId,
      playerId: dto.playerId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      amount: dto.money.amount,
      currency: dto.money.currency,
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
    });
  }

  @Get('wagering/transactions/:transactionId')
  async getById(@Param('transactionId') transactionId: string) {
    const tx = await this.wagerTransactionRepository.findById(transactionId, this.em.fork());
    if (!tx) {
      throw new NotFoundException(`Wager transaction "${transactionId}" not found.`);
    }
    return toTransactionView(tx);
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async getByProviderAndExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    const tx = await this.wagerTransactionRepository.findByProviderAndExternalId(
      providerId,
      externalTransactionId,
      this.em.fork(),
    );
    if (!tx) {
      throw new NotFoundException(
        `Wager transaction for provider "${providerId}" / external id "${externalTransactionId}" not found.`,
      );
    }
    return toTransactionView(tx);
  }
}
