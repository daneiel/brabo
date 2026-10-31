import { describe, it, expect } from 'vitest';
import { respostaCortada } from './resposta-cortada';

describe('respostaCortada (RN-749)', () => {
  it('caminho feliz: reconhece a linha do engine nos dois idiomas', () => {
    expect(respostaCortada('Texto pela met\n\nResposta cortada pelo limite de tamanho.')).toBe(true);
    expect(respostaCortada('Half text\n\nResponse cut off by the length limit.\n')).toBe(true);
  });

  it('resposta inteira, ou a frase no meio do texto, não é cortada', () => {
    expect(respostaCortada('Tudo certo.')).toBe(false);
    expect(respostaCortada('Resposta cortada pelo limite de tamanho. E depois continuei.')).toBe(false);
  });
});
