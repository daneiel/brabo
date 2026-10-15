import { describe, expect, it } from 'vitest';
import { aptaParaArquivar, deveArquivar, refDeArquivo } from './archive-branch.ts';

/**
 * A regra: toda branch mergeada é arquivada, exceto dev/qa/main (aparecem
 * como `head` de todo PR de promoção), `gh-pages` (deploy do site, não é
 * feature) e branch de fork (repositório que o token não controla).
 */

describe('deveArquivar', () => {
  const repo = 'daneiel/brabo';

  it('arquiva uma branch de feature normal, mergeada no mesmo repositório', () => {
    expect(deveArquivar('feature/reset-total-bootstrap', repo, repo)).toBe(true);
  });

  it('nunca arquiva as três permanentes, mesmo como head de PR de promoção', () => {
    expect(deveArquivar('dev', repo, repo)).toBe(false);
    expect(deveArquivar('qa', repo, repo)).toBe(false);
    expect(deveArquivar('main', repo, repo)).toBe(false);
  });

  it('nunca arquiva gh-pages — é deploy do site, não branch de feature', () => {
    expect(deveArquivar('gh-pages', repo, repo)).toBe(false);
  });

  it('não arquiva branch de fork — o token não é dono daquele repositório', () => {
    expect(deveArquivar('feature/x', 'terceiro/brabo', repo)).toBe(false);
  });

  it('branch vazia nunca arquiva', () => {
    expect(deveArquivar('', repo, repo)).toBe(false);
  });
});

describe('refDeArquivo', () => {
  it('move para o namespace refs/archive/, preservando barras do nome', () => {
    expect(refDeArquivo('feature/reset-total-bootstrap')).toBe(
      'refs/archive/feature/reset-total-bootstrap',
    );
  });
});

describe('aptaParaArquivar', () => {
  const repo = 'daneiel/brabo';
  const base = {
    branch: 'feature/x',
    headRepo: repo,
    baseRepo: repo,
    prAberta: false,
    ultimaMergeada: { mergedAt: '2026-10-08T12:00:00Z', headSha: 'abc' },
    shaAtual: 'abc',
    agora: new Date('2026-10-15T12:00:00Z'),
  };

  it('exatamente 7 dias depois do merge: arquiva', () => {
    expect(aptaParaArquivar(base).apta).toBe(true);
  });

  it('6 dias depois do merge: fica', () => {
    const r = aptaParaArquivar({ ...base, ultimaMergeada: { mergedAt: '2026-10-09T12:00:00Z', headSha: 'abc' } });
    expect(r).toEqual({ apta: false, motivo: 'mergeada há menos de 7 dias' });
  });

  it('com PR aberta: fica', () => {
    expect(aptaParaArquivar({ ...base, prAberta: true }).apta).toBe(false);
  });

  it('commit depois do merge: fica', () => {
    expect(aptaParaArquivar({ ...base, shaAtual: 'def' }).motivo).toBe('recebeu commit depois do merge');
  });

  it('permanentes e gh-pages: ficam', () => {
    for (const branch of ['dev', 'qa', 'main', 'gh-pages']) {
      expect(aptaParaArquivar({ ...base, branch }).apta).toBe(false);
    }
  });

  it('sem PR mergeada: fica', () => {
    expect(aptaParaArquivar({ ...base, ultimaMergeada: null }).apta).toBe(false);
  });
});
