import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, urlSegura } from './markdown';

describe('parseInline', () => {
  it('reconhece negrito, itálico (* e _), código inline e link seguro', () => {
    const nodes = parseInline('a **b** c *d* e _f_ g `h` [texto](https://x.dev)');
    expect(nodes).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c ' },
      { kind: 'italic', text: 'd' },
      { kind: 'text', text: ' e ' },
      { kind: 'italic', text: 'f' },
      { kind: 'text', text: ' g ' },
      { kind: 'code', text: 'h' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'texto', url: 'https://x.dev' },
    ]);
  });

  it('texto sem marcação nenhuma vira um único nó de texto', () => {
    expect(parseInline('sem marcação')).toEqual([{ kind: 'text', text: 'sem marcação' }]);
  });

  it('esquema inseguro (javascript:) degrada o link pro TEXTO — nunca vira href', () => {
    const nodes = parseInline('[clique aqui](javascript:alert(1))');
    expect(nodes).toEqual([{ kind: 'text', text: 'clique aqui' }]);
  });

  it('link relativo e âncora são seguros', () => {
    expect(urlSegura('/projects/1')).toBe(true);
    expect(urlSegura('#topo')).toBe(true);
    expect(urlSegura('https://a.dev')).toBe(true);
    expect(urlSegura('http://a.dev')).toBe(true);
    expect(urlSegura('javascript:alert(1)')).toBe(false);
    expect(urlSegura('data:text/html,x')).toBe(false);
  });
});

describe('parseMarkdown — blocos', () => {
  it('cabeçalhos # ## ### viram heading de nível 1/2/3', () => {
    const blocos = parseMarkdown('# Um\n## Dois\n### Três');
    expect(blocos).toEqual([
      { type: 'heading', level: 1, inline: [{ kind: 'text', text: 'Um' }] },
      { type: 'heading', level: 2, inline: [{ kind: 'text', text: 'Dois' }] },
      { type: 'heading', level: 3, inline: [{ kind: 'text', text: 'Três' }] },
    ]);
  });

  it('lista não ordenada (-) e ordenada (1.) viram blocos `list` distintos', () => {
    const blocos = parseMarkdown('- a\n- b\n\n1. x\n2. y');
    expect(blocos).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [
          [{ kind: 'text', text: 'a' }],
          [{ kind: 'text', text: 'b' }],
        ],
      },
      {
        type: 'list',
        ordered: true,
        items: [
          [{ kind: 'text', text: 'x' }],
          [{ kind: 'text', text: 'y' }],
        ],
      },
    ]);
  });

  it('parágrafo simples vira `paragraph`', () => {
    const blocos = parseMarkdown('uma frase qualquer');
    expect(blocos).toEqual([
      { type: 'paragraph', inline: [{ kind: 'text', text: 'uma frase qualquer' }] },
    ]);
  });

  it('fence com linguagem extrai a info string e o conteúdo', () => {
    const blocos = parseMarkdown('texto antes\n\n```bash\necho "oi"\n```\n\ntexto depois');
    expect(blocos).toEqual([
      { type: 'paragraph', inline: [{ kind: 'text', text: 'texto antes' }] },
      { type: 'code', lang: 'bash', content: 'echo "oi"' },
      { type: 'paragraph', inline: [{ kind: 'text', text: 'texto depois' }] },
    ]);
  });

  it('fence SEM linguagem degrada bem — lang vazia, sem quebrar o resto', () => {
    const blocos = parseMarkdown('```\nplain\n```');
    expect(blocos).toEqual([{ type: 'code', lang: '', content: 'plain' }]);
  });

  it('fence sem fechamento consome até o fim — nunca lança nem perde o resto do texto', () => {
    const blocos = parseMarkdown('```js\nconst a = 1;\nconst b = 2;');
    expect(blocos).toEqual([{ type: 'code', lang: 'js', content: 'const a = 1;\nconst b = 2;' }]);
  });

  it('mistura cabeçalho, parágrafo, lista e fence na ordem em que aparecem', () => {
    const blocos = parseMarkdown('# Título\n\nUm parágrafo.\n\n- item 1\n- item 2\n\n```ts\nconst x = 1;\n```');
    expect(blocos.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'code']);
  });
});
