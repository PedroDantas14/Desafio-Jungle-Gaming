import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';
import { MoneyDto } from '../../../../shared/interface/dto/money.dto';

export class CreateWalletRequestDto {
  @IsUUID()
  playerId!: string;

  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter uppercase ISO code, e.g. "BRL".' })
  currency!: string;

  /** > 0 gera um OPENING processado na mesma transação (seção 9). */
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance?: MoneyDto;
}
