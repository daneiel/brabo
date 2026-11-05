import { describe, expect, it } from 'vitest';
import {
  MAPA,
  blocosDeRn,
  gerarStubs,
  hospedeiroDaRn,
  partirDocmap,
  particionarRns,
  reescreverLink,
  reescreverLinks,
  reescreverLiteral,
} from './migrar-para-raizes.mjs';

const FIXTURE = `# RN
## Seção
### RN-001 — Com ref {#rn-001}

- **Onde:** \`apps/web/src/a.ts:10\` e \`apps/api/src/b.ts:3\`

### RN-002 — Só caminho {#rn-002}

Veja \`deploy/k8s/x.yaml\` e [RN-001](#rn-001).

### RN-003 — Sem nada {#rn-003}

Texto.
`;

describe('hospedeiroDaRn', () => {
  it('usa o PRIMEIRO caminho:N, não o primeiro app citado', () => {
    expect(hospedeiroDaRn('`apps/web/src/a.ts:10` `apps/api/b.ts:3`')).toBe('web');
  });
  it('sem caminho:N, o primeiro caminho citado; sem nada, produto', () => {
    expect(hospedeiroDaRn('ver `deploy/k8s/x.yaml`')).toBe('infra');
    expect(hospedeiroDaRn('texto')).toBe('produto');
    expect(hospedeiroDaRn('`packages/contracts/a.ts:1`')).toBe('contracts');
    expect(hospedeiroDaRn('`.github/workflows/a.yml:2`')).toBe('ci');
  });
});

describe('particionarRns', () => {
  const { porRaiz, mapa } = particionarRns([{ caminho: 'x', texto: FIXTURE }]);
  it('reparte por hospedeiro', () => {
    expect(blocosDeRn(FIXTURE)).toHaveLength(3);
    expect(Object.fromEntries(mapa)).toEqual({ 1: 'web', 2: 'infra', 3: 'produto' });
    expect(porRaiz.web[0].n).toBe(1);
  });
  it('a tradução usa o mesmo mapa, mesmo com o corpo apontando outro lugar', () => {
    const t = particionarRns([{ caminho: 'y', texto: '### RN-001 — x {#rn-001}\n\n`apps/api/z.ts:1`' }], mapa);
    expect(Object.keys(t.porRaiz)).toEqual(['web']);
  });
});

const host = (n: number) => ({ 1: 'web', 2: 'infra', 3: 'produto' })[n as 1 | 2 | 3];

describe('reescreverLink', () => {
  it('RN que sai do arquivo ganha a profundidade nova', () => {
    expect(reescreverLink('adr/0001.md', 'business-rules.md', 'business-rules/web.md', host)).toBe('../adr/0001.md');
  });
  it('#rn interno em outra raiz vira link para a página hospedeira', () => {
    expect(reescreverLink('#rn-002', 'business-rules.md', 'business-rules/web.md', host)).toBe('infra.md#rn-002');
    expect(reescreverLink('#rn-001', 'business-rules.md', 'business-rules/web.md', host)).toBe('#rn-001');
  });
  it('link que entra com #rn vai para a hospedeira', () => {
    expect(reescreverLink('../business-rules.md#rn-002', 'explanation/a.md', 'explanation/a.md', host)).toBe('../business-rules/infra.md#rn-002');
    expect(reescreverLink('../business-rules/custo.md#rn-001', 'explanation/a.md', 'explanation/a.md', host)).toBe('../business-rules/web.md#rn-001');
  });
  it('link entre páginas comuns e imagens não mudam', () => {
    expect(reescreverLink('./b.md', 'explanation/a.md', 'explanation/a.md', host)).toBe('./b.md');
    expect(reescreverLinks('![x](../assets/a.png) [y](../business-rules.md#rn-002)', 'explanation/a.md', 'explanation/a.md', host).texto).toBe(
      '![x](../assets/a.png) [y](../business-rules/infra.md#rn-002)',
    );
  });
  it('é idempotente', () => {
    const uma = reescreverLink('../business-rules.md#rn-002', 'explanation/a.md', 'explanation/a.md', host);
    expect(reescreverLink(uma, 'explanation/a.md', 'explanation/a.md', host)).toBe(uma);
  });
});

describe('stubs, mapa, literais, docmap', () => {
  it('o stub congela as âncoras com link para a hospedeira', () => {
    const s = gerarStubs([2, 1], new Map([[1, 'web'], [2, 'infra']]));
    expect(s).toContain('moram por área');
    expect(s).toContain('<a id="rn-001"></a>[RN-001](./web.md#rn-001)');
    expect(s.indexOf('rn-001')).toBeLessThan(s.indexOf('rn-002'));
  });
  it('MAPA leva fonte, tradução e catálogo do openapi', () => {
    expect(MAPA['docs/reference/permissions.md']).toBe('apps/api/docs/reference/permissions.md');
    expect(MAPA['docs/i18n/en/runbook.md']).toBe('deploy/docs/i18n/en/runbook.md');
    expect(MAPA['docs/i18n/ru/openapi-textos.json']).toBe('apps/api/docs/i18n/ru/openapi-textos.json');
  });
  it('lista literal de caminho movido', () => {
    expect(reescreverLiteral('x\nler docs/runbook.md aqui')).toEqual([{ linha: 2, de: 'docs/runbook.md', para: 'deploy/docs/runbook.md' }]);
  });
  it('docmap: regra na mesma raiz vai para a raiz; cruzada fica', () => {
    const t = `version: 1\n\nrules:\n  # c\n  - id: a\n    watch: ["apps/api/src/**"]\n    docs: ["docs/reference/permissions.md"]\n    severity: block\n\n  - id: b\n    watch: ["apps/web/src/**"]\n    docs: ["docs/reference/permissions.md"]\n    severity: warn\n`;
    const r = partirDocmap(t);
    expect(r.porRaiz.api).toContain('id: a');
    expect(r.porRaiz.api).toContain('# c');
    expect(r.cruzadas).toContain('id: b');
    expect(r.cruzadas).not.toContain('id: a');
  });
});
