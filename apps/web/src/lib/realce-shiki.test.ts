import { describe, expect, it } from 'vitest';
import { carregarRealce } from './realce-shiki';
import { temaShikiBrabo } from './tema-shiki-brabo';

describe('realce-shiki (RN-972)', () => {
  it('mapeia cores para os papéis de token', async () => {
    const linhas = await carregarRealce('const x = "a"; // c\nfunction f(n: number) {}', 'ts');
    const kinds = new Set(linhas!.flat().map((t) => t.kind));
    for (const k of ['keyword', 'string', 'comment', 'function', 'type']) expect(kinds).toContain(k);
    expect(linhas!.map((l) => l.map((t) => t.text).join('')).join('\n')).toContain('const x');
  });
  it('linguagem sem gramática devolve null', async () => {
    expect(await carregarRealce('x', 'brainfuck')).toBeNull();
  });
  it('o tema só usa var(--...)', () => {
    expect(JSON.stringify(temaShikiBrabo.settings)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
