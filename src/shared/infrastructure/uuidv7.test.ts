import { describe, expect, it } from 'bun:test';
import { uuidv7 } from './uuidv7';

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('gera um UUID no formato v7 (versão e variante corretas)', () => {
    expect(uuidv7()).toMatch(UUIDV7_PATTERN);
  });

  it('nunca repete (aleatoriedade suficiente em chamadas sucessivas)', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it('é ordenável lexicograficamente por tempo entre milissegundos distintos', async () => {
    const first = uuidv7();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = uuidv7();
    expect(first < second).toBe(true);
  });
});
