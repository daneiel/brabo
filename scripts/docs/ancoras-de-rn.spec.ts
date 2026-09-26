import { describe, expect, it } from 'vitest';
import { aferirAncoras, arquivosDeRn, conferirAncoras } from './ancoras-de-rn.mjs';
import { arquivos, ler } from './fontes.mjs';

/**
 * AT-230: RN-305 e RN-306 nasceram sem `{#rn-NNN}` e o `docs:check` não viu.
 * Cada caso de reprovação abaixo é uma MUTAÇÃO do cabeçalho correto — a
 * mutação reprova, a forma certa passa.
 */

const motivos = (texto: string) =>
  conferirAncoras(texto).problemas.map((p: { linha: number; rn: string; motivo: string }) => `${p.linha} ${p.rn}: ${p.motivo}`);

const CERTO = '### RN-305 — O Staff ativa pelo caminho GENÉRICO {#rn-305}';

describe('conferirAncoras — mutação', () => {
  it('o cabeçalho com a âncora do mesmo número passa', () => {
    expect(conferirAncoras(CERTO)).toEqual({ cabecalhos: 1, problemas: [] });
  });

  it('MUTAÇÃO: tirar a âncora reprova (o defeito de RN-305/306)', () => {
    expect(motivos('### RN-305 — O Staff ativa pelo caminho GENÉRICO')).toEqual([
      '1 RN-305: sem âncora — falta `{#rn-305}`',
    ]);
  });

  it('MUTAÇÃO: âncora de OUTRO número reprova', () => {
    expect(motivos('### RN-305 — O Staff {#rn-306}')).toEqual([
      '1 RN-305: âncora `{#rn-306}` diverge — deveria ser `{#rn-305}`',
    ]);
  });

  it('MUTAÇÃO: perder o zero à esquerda reprova (`RN-001` é `rn-001`)', () => {
    expect(conferirAncoras('### RN-001 — x {#rn-001}').problemas).toEqual([]);
    expect(motivos('### RN-001 — x {#rn-1}')).toEqual(['1 RN-001: âncora `{#rn-1}` diverge — deveria ser `{#rn-001}`']);
  });

  it('MUTAÇÃO: âncora com outro nome reprova', () => {
    expect(motivos('### RN-305 — x {#staff-generico}')).toHaveLength(1);
  });

  it('a âncora tem de estar no FIM: `{#rn-305}` no meio do título não conta', () => {
    expect(motivos('### RN-305 — ver `{#rn-305}` e o resto')).toHaveLength(1);
  });

  it('outro nível de cabeçalho que começa em RN- também é conferido', () => {
    expect(motivos('#### RN-410 — fora do padrão')).toHaveLength(1);
  });

  it('só cabeçalho que COMEÇA em RN- conta; seção que cita RN no meio não', () => {
    expect(conferirAncoras('## Staff: dormente (RN-305/RN-306, ADR 0088)\nRN-305 no texto')).toEqual({
      cabecalhos: 0,
      problemas: [],
    });
  });

  it('aferirAncoras soma os arquivos e diz o arquivo e a linha', () => {
    const textos: Record<string, string> = { 'a.md': `${CERTO}\n\n### RN-306 — sem`, 'b.md': '### RN-007 — x {#rn-007}' };
    const r = aferirAncoras(Object.keys(textos), (f: string) => textos[f]);
    expect(r.cabecalhos).toBe(3);
    expect(r.problemas).toEqual([{ arquivo: 'a.md', linha: 3, rn: 'RN-306', motivo: 'sem âncora — falta `{#rn-306}`' }]);
  });
});

describe('a árvore real', () => {
  const lista = arquivosDeRn(arquivos) as string[];

  it('varre os três arquivos de RN e as traduções pt-BR', () => {
    expect(lista).toEqual(
      expect.arrayContaining([
        'docs/business-rules.md',
        'docs/business-rules/custo.md',
        'docs/business-rules/autenticacao.md',
        'website/i18n/pt-BR/docusaurus-plugin-content-docs/current/business-rules.md',
        'website/i18n/pt-BR/docusaurus-plugin-content-docs/current/business-rules/custo.md',
        'website/i18n/pt-BR/docusaurus-plugin-content-docs/current/business-rules/autenticacao.md',
      ]),
    );
  });

  it('todo cabeçalho de RN tem a âncora certa, e a varredura não é cega', () => {
    const r = aferirAncoras(lista, ler);
    expect(r.problemas).toEqual([]);
    // A mesma régua da contagem de RNs em prosa (`### RN-NNN `), nos seis
    // arquivos: se divergir, um lado está pulando cabeçalho.
    const contagem = lista.reduce((soma, f) => soma + (ler(f).match(/^### RN-\d+ /gm) ?? []).length, 0);
    expect(r.cabecalhos).toBe(contagem);
    expect(r.cabecalhos).toBeGreaterThan(400);
  });
});
