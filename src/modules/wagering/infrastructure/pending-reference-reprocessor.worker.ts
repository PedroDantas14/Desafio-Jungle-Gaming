import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransactionRepository } from '../application/ports/wager-transaction.repository';
import { ProcessWagerTransactionUseCase } from '../application/process-wager-transaction.use-case';
import { WagerTransactionStatus } from '../domain/wager-transaction';

const BATCH_SIZE = 20;

// Regra 7.1 do desafio: espera pela referência tem que ter um limite,
// "limite de tentativas OU TTL" — escolhemos TTL porque WagerTransaction
// (seção 6.3) não tem campo de contagem de tentativas, e um TTL fixo é
// mais simples de operar do que inventar um campo novo só pra isso. Dez
// minutos é generoso o bastante pra cobrir a maioria das entregas fora de
// ordem via SQS sem deixar a transação pendurada indefinidamente.
const REFERENCE_TTL_MS = 10 * 60 * 1_000;

// Backoff no próprio ritmo de polling do worker (não é retry por
// transação — isso quem decide é o TTL acima): se um ciclo resolveu
// alguma coisa, o próximo roda logo em seguida (mais referências podem
// ter chegado juntas); se não resolveu nada, alarga o intervalo até o
// teto, pra não ficar batendo no banco à toa quando a fila de pendentes
// está parada.
const BASE_INTERVAL_MS = 2_000;
const MAX_INTERVAL_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reprocessa transações em `PENDING_REFERENCE` (seção 7.1): tenta resolver
 * a referência de novo (pode ter chegado nesse meio tempo) ou expira com
 * `REFERENCE_NOT_FOUND` depois do TTL. Roda continuamente a partir do
 * `onModuleInit`, igual ao `OutboxPublisherWorker` — múltiplas instâncias
 * são seguras porque cada transação é reprocessada dentro da sua própria
 * transação SQL com a wallet travada (`retryPendingReference`/
 * `expirePendingReference` já são protegidos contra corrida: releem o
 * status fresco antes de agir e viram no-op se outra instância já
 * resolveu).
 */
@Injectable()
export class PendingReferenceReprocessorWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingReferenceReprocessorWorker.name);
  private stopped = false;
  private loopPromise?: Promise<void>;
  private currentIntervalMs = BASE_INTERVAL_MS;

  constructor(
    private readonly em: EntityManager,
    private readonly wagerTransactionRepository: WagerTransactionRepository,
    private readonly processWagerTransactionUseCase: ProcessWagerTransactionUseCase,
  ) {}

  onModuleInit(): void {
    this.loopPromise = this.pollLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.loopPromise;
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const resolved = await this.reprocessBatch();
        this.currentIntervalMs =
          resolved > 0 ? BASE_INTERVAL_MS : Math.min(this.currentIntervalMs * 2, MAX_INTERVAL_MS);
      } catch (error) {
        this.logger.error(
          `Reprocess cycle failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        this.currentIntervalMs = Math.min(this.currentIntervalMs * 2, MAX_INTERVAL_MS);
      }

      await sleep(this.currentIntervalMs);
    }
  }

  /**
   * Um lote: lê as transações `PENDING_REFERENCE` mais antigas e tenta
   * resolver cada uma na sua PRÓPRIA transação SQL — uma falha isolada
   * (ex.: wallet travada por outra instância nesse instante) não deve
   * derrubar o lote inteiro. Devolve quantas mudaram de status neste ciclo.
   */
  async reprocessBatch(batchSize = BATCH_SIZE): Promise<number> {
    const batch = await this.em.transactional((em) =>
      this.wagerTransactionRepository.findPendingReferenceBatch(batchSize, em),
    );

    let resolved = 0;

    for (const transaction of batch) {
      try {
        const expired = Date.now() - transaction.createdAt.getTime() > REFERENCE_TTL_MS;

        const afterStatus = await this.em.transactional(async (em) => {
          if (expired) {
            await this.processWagerTransactionUseCase.expirePendingReference(transaction.id, em);
          } else {
            await this.processWagerTransactionUseCase.retryPendingReference(transaction.id, em);
          }
          const after = await this.wagerTransactionRepository.findById(transaction.id, em);
          return after?.status;
        });

        if (afterStatus && afterStatus !== WagerTransactionStatus.PendingReference) {
          resolved += 1;
        }
      } catch (error) {
        this.logger.error(
          `Failed to reprocess wager transaction "${transaction.id}": ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    return resolved;
  }
}
