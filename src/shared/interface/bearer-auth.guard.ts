import {
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Request } from 'express';

/**
 * Valida `Authorization: Bearer <jwt>` contra o JWKS de um Identity
 * Provider externo (seção 2 do desafio: "integrar um IdP externo, nada
 * de auth artesanal" — Keycloak/Zitadel são as sugestões). Só *valida*
 * token, nunca emite — não existe endpoint de login aqui.
 *
 * Autenticação **não vale pontos** e não deve competir com correção
 * financeira/concorrência/idempotência (seção 2, explícito). Por isso:
 * sem `AUTH_JWKS_URI` configurado, o guard fica em modo "desabilitado"
 * (loga aviso uma vez, deixa passar) — decisão deliberada de escopo pra
 * não gastar tempo do desafio subindo um Keycloak completo no
 * docker-compose só pra isso, documentada aqui e no ARCHITECTURE.md.
 * Com `AUTH_JWKS_URI` configurado (contra um IdP de verdade), a
 * validação é real: assinatura, issuer, expiração.
 */
@Injectable()
export class BearerAuthGuard implements CanActivate {
  private readonly logger = new Logger(BearerAuthGuard.name);
  private jwks?: JWTVerifyGetKey;
  private warnedDisabled = false;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const jwksUri = process.env.AUTH_JWKS_URI;

    if (!jwksUri) {
      if (!this.warnedDisabled) {
        this.logger.warn(
          'AUTH_JWKS_URI não configurado — autenticação DESABILITADA (decisão de escopo, seção 2: não vale pontos). Configure AUTH_JWKS_URI + AUTH_ISSUER pra habilitar de verdade.',
        );
        this.warnedDisabled = true;
      }
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token.');
    }

    const token = header.slice('Bearer '.length);
    this.jwks ??= createRemoteJWKSet(new URL(jwksUri));

    try {
      await jwtVerify(token, this.jwks, {
        issuer: process.env.AUTH_ISSUER,
      });
      return true;
    } catch (error) {
      throw new UnauthorizedException(
        `Invalid token: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
