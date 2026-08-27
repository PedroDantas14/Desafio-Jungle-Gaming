import { IsString, Length, Matches } from 'class-validator';

/**
 * Validação estrutural só (formato). A validação de verdade — que o
 * valor é positivo onde precisa ser, etc. — fica no domínio
 * (`Money.fromString`), pra não duplicar regra de negócio no DTO.
 */
export class MoneyDto {
  @IsString()
  @Matches(/^-?\d+\.\d{2}$/, { message: 'amount must be a fixed 2-decimal value, e.g. "100.00".' })
  amount!: string;

  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter uppercase ISO code, e.g. "BRL".' })
  currency!: string;
}
