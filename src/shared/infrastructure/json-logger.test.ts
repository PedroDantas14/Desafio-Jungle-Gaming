import { describe, expect, it } from 'bun:test';
import { JsonLogger } from './json-logger';

/**
 * Testa `write()` capturando o que vai pra `process.stdout.write` — não
 * dá pra testar o output real de outra forma sem sujar o terminal do
 * test runner. Cobre as duas convenções de assinatura do Nest
 * (`log(message, context?)` e `error(message, trace?, context?)`) e a
 * remoção de ANSI que o logger interno do MikroORM injeta.
 */
function captureLines(fn: () => void): unknown[] {
  const lines: unknown[] = [];
  const original = process.stdout.write.bind(process.stdout);
  // Sobrescrita deliberada só durante o teste, restaurada no finally.
  process.stdout.write = (chunk: string) => {
    lines.push(JSON.parse(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return lines;
}

describe('JsonLogger', () => {
  it('escreve uma linha JSON com timestamp, level e message pra uma string simples', () => {
    const logger = new JsonLogger();

    const [entry] = captureLines(() => logger.log('Application listening on port 3000'));

    expect(entry).toMatchObject({
      level: 'log',
      message: 'Application listening on port 3000',
    });
    expect(typeof (entry as { timestamp: string }).timestamp).toBe('string');
  });

  it('promove o ÚLTIMO optionalParam string pra "context" (convenção do Nest)', () => {
    const logger = new JsonLogger();

    const [entry] = captureLines(() => logger.log('Database connection established', 'Bootstrap'));

    expect(entry).toMatchObject({
      message: 'Database connection established',
      context: 'Bootstrap',
    });
  });

  it('promove os campos de um objeto pro nível raiz da linha, sem "message"', () => {
    const logger = new JsonLogger();

    const [entry] = captureLines(() =>
      logger.log(
        { event: 'wager_transaction_finalized', transactionId: 'tx-1', status: 'PROCESSED' },
        'ProcessWagerTransactionUseCase',
      ),
    );

    expect(entry).toMatchObject({
      event: 'wager_transaction_finalized',
      transactionId: 'tx-1',
      status: 'PROCESSED',
      context: 'ProcessWagerTransactionUseCase',
    });
    expect(entry).not.toHaveProperty('message');
  });

  it('error() com trace E context: extrai os dois (trace antes do context)', () => {
    const logger = new JsonLogger();

    const [entry] = captureLines(() =>
      logger.error('boom', 'stack trace here', 'SomeService'),
    );

    expect(entry).toMatchObject({
      level: 'error',
      message: 'boom',
      stack: 'stack trace here',
      context: 'SomeService',
    });
  });

  it('error() sem trace (undefined) ainda resolve o context corretamente', () => {
    // Padrão usado em main.ts: Logger.error(msg, undefined, 'Bootstrap').
    const logger = new JsonLogger();

    const [entry] = captureLines(() => logger.error('failed to connect', undefined, 'Bootstrap'));

    expect(entry).toMatchObject({ message: 'failed to connect', context: 'Bootstrap' });
    expect(entry).not.toHaveProperty('stack');
  });

  it('remove sequências de escape ANSI de strings (mensagens coloridas do MikroORM)', () => {
    const logger = new JsonLogger();

    const [entry] = captureLines(() =>
      logger.log('[90m[query] [39mselect 1[90m [took 1 ms][39m'),
    );

    expect(entry).toMatchObject({ message: '[query] select 1 [took 1 ms]' });
  });
});
