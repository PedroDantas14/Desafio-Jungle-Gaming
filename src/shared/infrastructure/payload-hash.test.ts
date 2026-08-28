import { describe, expect, it } from 'bun:test';
import { canonicalPayloadHash } from './payload-hash';

describe('canonicalPayloadHash', () => {
  it('é determinístico para o mesmo objeto', () => {
    const value = { providerId: 'p1', kind: 'BET' };
    expect(canonicalPayloadHash(value)).toBe(canonicalPayloadHash(value));
  });

  it('ignora a ordem das chaves — mesmo conteúdo, ordens diferentes, mesmo hash', () => {
    const a = { providerId: 'p1', kind: 'BET', money: { amount: '80.00', currency: 'BRL' } };
    const b = { kind: 'BET', money: { currency: 'BRL', amount: '80.00' }, providerId: 'p1' };
    expect(canonicalPayloadHash(a)).toBe(canonicalPayloadHash(b));
  });

  it('conteúdo diferente produz hash diferente', () => {
    const a = { providerId: 'p1', amount: '80.00' };
    const b = { providerId: 'p1', amount: '80.01' };
    expect(canonicalPayloadHash(a)).not.toBe(canonicalPayloadHash(b));
  });

  it('trata chave ausente e chave com valor undefined como equivalentes', () => {
    const withUndefined = { providerId: 'p1', referenceExternalTransactionId: undefined };
    const withoutKey = { providerId: 'p1' };
    expect(canonicalPayloadHash(withUndefined)).toBe(canonicalPayloadHash(withoutKey));
  });

  it('diferencia null de undefined/ausente', () => {
    const withNull = { providerId: 'p1', referenceExternalTransactionId: null };
    const withoutKey = { providerId: 'p1' };
    expect(canonicalPayloadHash(withNull)).not.toBe(canonicalPayloadHash(withoutKey));
  });
});
