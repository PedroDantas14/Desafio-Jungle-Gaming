import type { LoggerService, LogLevel } from '@nestjs/common';

// eslint-disable-next-line no-control-regex -- remove sequências de escape ANSI (o logger interno do MikroORM colore texto assumindo um terminal, não faz sentido dentro de um campo JSON).
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

/**
 * Logger estruturado (seção 12 do desafio: "logs estruturados (JSON)").
 * Substitui o `ConsoleLogger` padrão do Nest via `app.useLogger()` em
 * `main.ts` — dali em diante, todo `new Logger(Ctx).log(...)` do app
 * inteiro (bootstrap, workers, consumer, use cases) passa por aqui.
 *
 * `message` pode ser uma string simples (log de infraestrutura, ex:
 * "Application listening on port 3000") ou um objeto de campos (log de
 * domínio, ex: `{ event: 'wager_transaction_finalized', transactionId,
 * walletId, providerId, correlationId, status }`) — nesse caso os campos
 * são promovidos pro nível raiz da linha JSON, prontos pra filtrar/agregar
 * num agregador de log sem parsing extra. A escolha de nunca aceitar um
 * payload financeiro inteiro ou o corpo de uma mensagem SQS como campo é
 * disciplina de quem chama (seção 12: "sem dados sensíveis ou payloads
 * financeiros completos") — este logger só formata o que recebe.
 */
export class JsonLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams);
  }

  setLogLevels(_levels: LogLevel[]): void {
    // Sem filtro de nível — filtragem de volume fica a cargo do agregador
    // de log a jusante; um JSON estruturado não deveria perder sinal por
    // engano aqui dentro.
  }

  private write(level: string, message: unknown, optionalParams: unknown[]): void {
    const rest = [...optionalParams];

    // Convenção do Nest: quando presente, o ÚLTIMO optionalParam de
    // log/warn/debug/verbose/fatal é o "context" (string, nome da
    // classe). Em error(), pode vir stack ANTES do context:
    // error(message, trace?, context?).
    let context: string | undefined;
    if (rest.length > 0 && typeof rest[rest.length - 1] === 'string') {
      context = rest.pop() as string;
    }
    const stack =
      level === 'error' && typeof rest[0] === 'string' ? (rest.shift() as string) : undefined;

    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
    };

    if (typeof message === 'string') {
      entry.message = stripAnsi(message);
    } else if (message && typeof message === 'object') {
      Object.assign(entry, message);
    } else {
      entry.message = String(message);
    }

    if (stack) {
      entry.stack = stripAnsi(stack);
    }

    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}
