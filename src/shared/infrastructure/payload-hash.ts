import { createHash } from 'node:crypto';

/**
 * Hash SHA-256 de um JSON **canônico** (chaves ordenadas, recursivamente)
 * — seção 9: "`payloadHash` = hash de um JSON canônico (chaves ordenadas)
 * do subconjunto de campos de negócio — o header e metadados de
 * transporte não entram no hash. O algoritmo deve estar documentado."
 *
 * Este é o único algoritmo usado nos dois pontos de entrada (HTTP via
 * `WageringController`, SQS via `WagerTransactionConsumer`) — a mesma
 * operação de negócio produz o mesmo hash não importa por qual porta ela
 * entrou. Cada chamador monta explicitamente o subconjunto de campos de
 * negócio (nunca o objeto bruto da requisição/mensagem inteira, que
 * carrega metadado de transporte — header, `messageId`, `occurredAt`).
 */
export function canonicalPayloadHash(businessFields: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalize(businessFields)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    // `undefined` explícito (ex: campo opcional ausente) não entra —
    // equivalente a omitir a chave, como JSON.stringify já faz por padrão.
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);

  return `{${entries.join(',')}}`;
}
