/**
 * Gerador de UUIDv7 (RFC 9562) — 48 bits de timestamp Unix em ms
 * (big-endian) + 4 bits de versão + 74 bits aleatórios (12 + 62,
 * separados pelos 2 bits de variante). Time-ordered: bate com o formato
 * de id usado nos exemplos da seção 9 do desafio, e ajuda o índice da
 * PK a ficar sequencial (menos fragmentação que UUIDv4 aleatório puro).
 *
 * Sem contador de monotonicidade dentro do mesmo milissegundo — não é
 * garantido estritamente crescente para duas chamadas no mesmo ms, mas é
 * suficiente para a ordenação grosseira que o formato pede aqui.
 */
export function uuidv7(): string {
  const unixTsMs = BigInt(Date.now());
  const bytes = new Uint8Array(16);

  bytes[0] = Number((unixTsMs >> 40n) & 0xffn);
  bytes[1] = Number((unixTsMs >> 32n) & 0xffn);
  bytes[2] = Number((unixTsMs >> 24n) & 0xffn);
  bytes[3] = Number((unixTsMs >> 16n) & 0xffn);
  bytes[4] = Number((unixTsMs >> 8n) & 0xffn);
  bytes[5] = Number(unixTsMs & 0xffn);

  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  bytes.set(random, 6);

  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70; // versão 7
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // variante RFC 9562

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
