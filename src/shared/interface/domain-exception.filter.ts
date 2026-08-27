import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../domain/domain-error';

// Mapa explícito de `code` de domínio pra status HTTP — falha ao mapear
// (código novo esquecido aqui) cai no default 400, nunca em 500 silencioso.
const STATUS_BY_CODE: Record<string, HttpStatus> = {
  WALLET_NOT_FOUND: HttpStatus.NOT_FOUND,
  WALLET_ALREADY_EXISTS: HttpStatus.CONFLICT,
  INSUFFICIENT_BALANCE: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_MONEY_AMOUNT: HttpStatus.BAD_REQUEST,
  INVALID_CURRENCY: HttpStatus.BAD_REQUEST,
  CURRENCY_MISMATCH: HttpStatus.BAD_REQUEST,
  INVALID_WAGER_TRANSACTION: HttpStatus.BAD_REQUEST,
  INVALID_STATE_TRANSITION: HttpStatus.CONFLICT,
  UNSUPPORTED_WAGER_KIND: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_LEDGER_ENTRY: HttpStatus.INTERNAL_SERVER_ERROR,
  INVALID_OUTBOX_MESSAGE: HttpStatus.INTERNAL_SERVER_ERROR,
  INVALID_WAGER_MESSAGE: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * Traduz `DomainError` pra resposta HTTP — `code` no corpo além de
 * `message`, pra cliente conseguir decidir programaticamente sem parsear
 * texto. Domínio nunca soube de HTTP (ver `domain-error.ts`); esse
 * mapeamento vive só aqui, na borda.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.BAD_REQUEST;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${exception.code}: ${exception.message}`);
    }

    response.status(status).json({
      statusCode: status,
      code: exception.code,
      message: exception.message,
    });
  }
}
