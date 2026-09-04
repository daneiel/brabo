import { describe, expect, it } from 'vitest';
import { deveArquivar, refDeArquivo } from './archive-branch.ts';

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
