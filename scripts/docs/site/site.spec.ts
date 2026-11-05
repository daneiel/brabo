import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { construir } from './build.mjs';
import { adrsPorTema, construirNavegacao, listaPlana } from './navegacao.mjs';
import { descobrirPaginas, lerFrontmatter, slugDe, urlDe, urlRelativa } from './paginas.mjs';
import { criarRenderizador, slugDeTitulo } from './render.mjs';

/** Repositório de mentira: duas páginas, uma tradução, um ADR com tema. */
function repo() {
  const raiz = mkdtempSync(path.join(tmpdir(), 'site-'));
  const w = (rel: string, txt: string) => {
    mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
    writeFileSync(path.join(raiz, rel), txt);
  };
  w('docs/intro.md', '---\ntitle: Início\nslug: /\n---\n# Início\n\nVeja [o ADR](adr/0001-x.md#decisao) e [API](/reference/api/).\n');
  w('docs/adr/index.md', '---\nid: adr-index\n---\n# ADRs\n');
  w('docs/adr/0001-x.md', '# ADR 0001 — x\n\n## Decisão {#decisao}\n\n:::warning[Cuidado!]\ncorpo\n:::\n\n```mermaid\nA-->B\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  w('docs/adr/temas.yml', 'temas:\n  - id: docs\n    titulo: Documentação\n    descricao: x\nadrs:\n  "0001": docs\n');
  w('docs/missions/m.md', '# fora');
  w('docs/_parcial.md', '# fora');
  w('docs/i18n/en/adr/0001-x.md', '# ADR 0001 — x (en)\n\n## Decisão {#decisao}\n\n[home](../intro.md)\n');
  return raiz;
}

describe('paginas', () => {
  it('mantém as URLs do Docusaurus e exclui missions e parciais', () => {
    const p = descobrirPaginas({ raiz: repo(), locale: 'pt-BR' });
    expect(p.map((x) => x.url).sort()).toEqual(['adr.html', 'adr/0001-x.html', 'index.html']);
    expect(urlDe('a/b', 'ru')).toBe('ru/a/b.html');
    expect(slugDe('adr/index.md')).toBe('adr');
    expect(urlRelativa('en/adr/0001-x.html', 'en/index.html')).toBe('../index.html');
  });

  it('o locale tem o conjunto inteiro: tradução onde existe, fonte no resto', () => {
    const p = descobrirPaginas({ raiz: repo(), locale: 'en' });
    expect(p.map((x) => [x.url, x.traduzida])).toEqual([
      ['en/adr/0001-x.html', true], ['en/adr.html', false], ['en/index.html', false],
    ]);
  });

  it('frontmatter malformado reprova', () => {
    expect(() => lerFrontmatter('---\na: [\n---\n')).toThrow(/frontmatter/);
  });
});

describe('render', () => {
  it('âncora {#id}, admonição, mermaid, tabela e link .md relativo ao locale', async () => {
    const raiz = repo();
    const paginas = descobrirPaginas({ raiz, locale: 'en' });
    const render = await criarRenderizador({ paginas });
    const adr = render(paginas.find((p) => p.slug === 'adr/0001-x')!);
    expect(adr.html).toContain('id="decisao"');
    expect(adr.html).not.toContain('{#decisao}');
    expect(adr.toc).toEqual([{ nivel: 2, id: 'decisao', texto: 'Decisão' }]);
    const intro = render(paginas.find((p) => p.slug === '')!);
    expect(intro.html).toContain('href="adr/0001-x.html#decisao"');
    expect(intro.html).toContain('href="reference/api.html"');
    const pt = descobrirPaginas({ raiz, locale: 'pt-BR' });
    const fonte = (await criarRenderizador({ paginas: pt }))(pt.find((p) => p.slug === 'adr/0001-x')!);
    expect(fonte.html).toContain('admonicao-warning');
    expect(fonte.html).toContain('Cuidado!');
    expect(fonte.html).toContain('<pre class="mermaid" data-mermaid>');
    expect(fonte.html).toContain('tabela-rolavel');
    expect(fonte.temMermaid).toBe(true);
    expect(slugDeTitulo('O que é o Brabo?')).toBe('o-que-é-o-brabo');
  });

  it('link que atravessa para a tradução fica dentro do locale (caso de falha: alvo sumido fica cru)', async () => {
    const raiz = repo();
    const paginas = descobrirPaginas({ raiz, locale: 'en' });
    const render = await criarRenderizador({ paginas });
    const adr = paginas.find((p) => p.slug === 'adr/0001-x')!;
    expect(render(adr).html).toContain('href="../index.html"');
    const sumido = { ...adr, corpo: '[x](nao-existe.md)' };
    expect(render(sumido).html).toContain('href="nao-existe.md"');
  });
});

describe('navegacao', () => {
  it('agrupa ADRs pelo temas.yml e lança se o parse se perde', () => {
    const raiz = repo();
    expect(adrsPorTema(raiz)).toEqual([{ rotulo: 'Documentação', itens: ['adr/0001-x'] }]);
    writeFileSync(path.join(raiz, 'docs/adr/0002-y.md'), '# y');
    expect(() => adrsPorTema(raiz)).toThrow(/se perdeu/);
  });

  it('aplica rótulos traduzidos e lista na ordem de leitura', () => {
    const nav = construirNavegacao({ raiz: repo(), rotulos: { '🛠️ Operação': 'Ops' } });
    expect(nav.some((i) => i.rotulo === 'Ops')).toBe(true);
    expect(listaPlana(nav)[0]?.slug).toBe('');
  });
});

describe('build', () => {
  it('escreve uma página por url em cada locale, com noindex fora da main', async () => {
    const raiz = repo();
    const saida = path.join(raiz, 'out');
    await construir({ raiz, saida, degrau: 'dev', git: false });
    expect(readFileSync(path.join(saida, 'index.html'), 'utf8')).toContain('noindex');
    expect(readFileSync(path.join(saida, 'zh-Hans/adr/0001-x.html'), 'utf8')).toContain('lang="zh-Hans"');
    await construir({ raiz, saida, degrau: 'main', git: false });
    expect(readFileSync(path.join(saida, 'index.html'), 'utf8')).not.toContain('noindex');
  }, 120_000);
});

describe('árvore de união das raízes (AT-693)', () => {
  const duas = () => {
    const raiz = repo();
    const w = (rel: string, txt: string) => {
      mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
      writeFileSync(path.join(raiz, rel), txt);
    };
    w('apps/api/docs/reference/permissions.md', '# Permissões\n');
    w('apps/api/docs/business-rules/api.md', '# RN api\n');
    w('apps/api/docs/i18n/en/reference/permissions.md', '# Permissions\n');
    return { raiz, w };
  };
  const raizesDeDoc = ['docs', 'apps/api/docs'];

  it('une as raízes, guarda a raiz de cada página e traduz por raiz', () => {
    const { raiz } = duas();
    const pt = descobrirPaginas({ raiz, locale: 'pt-BR', raizesDeDoc });
    expect(pt.find((p) => p.slug === 'reference/permissions')?.raiz).toBe('apps/api/docs');
    expect(pt.find((p) => p.slug === 'adr')?.raiz).toBe('docs');
    const en = descobrirPaginas({ raiz, locale: 'en', raizesDeDoc });
    expect(en.find((p) => p.slug === 'reference/permissions')).toMatchObject({ traduzida: true, titulo: 'Permissions' });
  });

  it('slug duplicado entre raízes lança nomeando as duas', () => {
    const { raiz, w } = duas();
    w('docs/reference/permissions.md', '# Outra\n');
    expect(() => descobrirPaginas({ raiz, raizesDeDoc })).toThrow(/docs\/reference\/permissions\.md e apps\/api\/docs\/reference\/permissions\.md|apps\/api\/docs\/reference\/permissions\.md e docs\/reference\/permissions\.md/);
  });

  it('as Regras listam uma página por raiz e a edição aponta para a raiz da página', async () => {
    const { raiz } = duas();
    const nav = construirNavegacao({ raiz, repo: 'x/y', raizesDeDoc });
    const regras = nav.find((i: any) => i.rotulo.includes('Regras'));
    expect(regras.itens.map((i: any) => i.slug)).toEqual(['business-rules', 'business-rules/api']);
    const saida = path.join(raiz, 'out');
    await construir({ raiz, saida, git: false, repo: 'x/y', raizesDeDoc });
    expect(readFileSync(path.join(saida, 'reference/permissions.html'), 'utf8')).toContain('blob/dev/apps/api/docs/reference/permissions.md');
    expect(readFileSync(path.join(saida, 'index.html'), 'utf8')).toContain('blob/dev/docs/intro.md');
  }, 120_000);
});
