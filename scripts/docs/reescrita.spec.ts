import { describe, expect, it } from 'vitest';
import { extrairRefs, novaLinha, reancorar } from './refs-com-simbolo.mjs';
import { deduplicarProximoAdr, PROXIMO_ADR, substituirGrupo } from './reescrita.mjs';
import { corrigirRecuo } from './temas-de-adr.mjs';

/**
 * AT-399: o `pnpm docs:generate` reescreve os números deriváveis da prosa.
 * Cada função prova a correção (feliz) e o caso que continua pedindo humano.
 */

describe('substituirGrupo — contagens de ADR/RN e próximo ADR', () => {
  it('troca só o número da frase', () => {
    const t = 'Leia as 207 decisões e o porquê. 207 outras.';
    expect(substituirGrupo(t, /as (\d+) decisões e o porquê/, '208')).toBe('Leia as 208 decisões e o porquê. 207 outras.');
  });
  it('troca o grupo, não um número igual dentro do link', () => {
    const t = 'the [ADRs](adr/0208.md) — 208 of them';
    expect(substituirGrupo(t, /\[ADRs\]\([^)]*\) — (\d+) of\s+them/, '209')).toBe('the [ADRs](adr/0208.md) — 209 of them');
  });
  it('padrão que não casa deixa o texto intocado (o check diz CEGO)', () => {
    expect(substituirGrupo('nada', /as (\d+) RNs, cada uma com/, '5')).toBe('nada');
  });
});

describe('deduplicarProximoAdr', () => {
  it('a linha repetida pelo merge sai, a primeira fica', () => {
    const t = 'a\nis superseded — the next one is **0209**.\nis superseded — the next one is **0210**.\nb';
    const saida = deduplicarProximoAdr(t);
    expect(saida).toBe('a\nis superseded — the next one is **0209**.\nb');
    expect(substituirGrupo(saida, PROXIMO_ADR, '0211')).toContain('**0211**');
  });
  it('sem duplicata, intocado', () => {
    const t = 'x the next one is **0209**.';
    expect(deduplicarProximoAdr(t)).toBe(t);
  });
});

describe('corrigirRecuo — temas.yml', () => {
  it('recua a linha de ADR escrita na coluna 0', () => {
    const yml = 'temas:\n  - id: git\nadrs:\n  "0001": git\n"0002": git\n';
    expect(corrigirRecuo(yml)).toBe('temas:\n  - id: git\nadrs:\n  "0001": git\n  "0002": git\n');
  });
  it('arquivo certo fica intocado', () => {
    const yml = 'adrs:\n  "0001": git\n';
    expect(corrigirRecuo(yml)).toBe(yml);
  });
});

describe('reancorar — refs `caminho:N` (`símbolo`)', () => {
  const arquivo = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'function foo() {', 'x', 'y'];

  const reescrever = (doc: string) => {
    const refs = (extrairRefs(doc) as { linha: number; simbolo: string }[]).map((r) => ({
      ...r,
      novaLinha: novaLinha(arquivo, r.linha, r.simbolo),
    }));
    return reancorar(doc, refs as never);
  };

  it('ref explícita deslocada vai para a linha do símbolo', () => {
    expect(reescrever('- `src/a.ts:1` (`foo`)')).toBe('- `src/a.ts:9` (`foo`)');
  });
  it('a continuação e a forma quebrada no fim da linha também', () => {
    const doc = '- `src/a.ts:2` (`foo`), `:1`\n  (`foo`)';
    expect(reescrever(doc)).toBe('- `src/a.ts:9` (`foo`), `:9`\n  (`foo`)');
  });
  it('mantém o resto do documento intocado, inclusive antes do item', () => {
    const doc = '# t\n\ntexto\n\n- `src/a.ts:100` (`foo`)\n';
    expect(reescrever(doc)).toBe('# t\n\ntexto\n\n- `src/a.ts:9` (`foo`)\n');
  });
  it('símbolo que sumiu do arquivo NÃO é reescrito — pede humano', () => {
    expect(novaLinha(arquivo, 1, 'sumiu')).toBeNull();
    expect(reescrever('- `src/a.ts:1` (`sumiu`)')).toBe('- `src/a.ts:1` (`sumiu`)');
  });
  it('empate entre duas ocorrências NÃO é reescrito', () => {
    expect(novaLinha(['foo', 'x', 'foo'], 2, 'foo')).toBeNull();
  });
});
