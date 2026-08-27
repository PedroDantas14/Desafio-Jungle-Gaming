import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { MoneyDto } from '../../../../shared/interface/dto/money.dto';
import { WagerTransactionKind } from '../../domain/wager-transaction';

export class ProcessWagerTransactionRequestDto {
  @IsString()
  providerId!: string;

  @IsString()
  externalTransactionId!: string;

  @IsUUID()
  playerId!: string;

  @IsUUID()
  walletId!: string;

  @IsString()
  roundId!: string;

  @IsString()
  gameId!: string;

  @IsEnum(WagerTransactionKind)
  kind!: WagerTransactionKind;

  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  /** Só usado por REFUND/ROLLBACK (Parte 7) — aceito aqui pra não quebrar o contrato quando chegarem. */
  @IsOptional()
  @IsString()
  referenceExternalTransactionId?: string;
}
