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

/**
 * RN-176 — a tabela do Mapa de Módulos do Arquiteto saía como parágrafo com
 * pipes literais. O que distingue tabela de prosa com `|` é a linha
 * SEPARADORA, e é ela que estes testes cobrem nos dois sentidos.
 */
describe('parseMarkdown — tabela (RN-176)', () => {
  it('cabeçalho + separador + linhas viram um bloco table', () => {
    const blocos = parseMarkdown(
      '| Módulo | Stack |\n| --- | --- |\n| api | NestJS |\n| web | React |',
    );
    expect(blocos).toEqual([
      {
        type: 'table',
        header: [
          [{ kind: 'text', text: 'Módulo' }],
          [{ kind: 'text', text: 'Stack' }],
        ],
        aligns: ['left', 'left'],
        rows: [
          [[{ kind: 'text', text: 'api' }], [{ kind: 'text', text: 'NestJS' }]],
          [[{ kind: 'text', text: 'web' }], [{ kind: 'text', text: 'React' }]],
        ],
      },
    ]);
  });

  it('SEM a linha separadora continua sendo parágrafo — prosa com `|` não vira tabela', () => {
    const blocos = parseMarkdown('escolha entre a | b | c');
    expect(blocos.map((b) => b.type)).toEqual(['paragraph']);
  });

  it('lê o alinhamento dos dois-pontos do separador', () => {
    const [bloco] = parseMarkdown('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |');
    expect(bloco).toMatchObject({ type: 'table', aligns: ['left', 'center', 'right'] });
  });

  it('linha curta ganha célula vazia e linha longa perde o excesso — o cabeçalho manda', () => {
    const [bloco] = parseMarkdown('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |');
    expect(bloco).toEqual({
      type: 'table',
      header: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
      aligns: ['left', 'left'],
      rows: [
        // Célula ausente vira sequência inline VAZIA (`parseInline('')`), e
        // não um nó de texto em branco.
        [[{ kind: 'text', text: '1' }], []],
        [[{ kind: 'text', text: '1' }], [{ kind: 'text', text: '2' }]],
      ],
    });
  });

  it('célula mantém a formatação inline (código, negrito)', () => {
    const [bloco] = parseMarkdown('| Módulo | Depende |\n| --- | --- |\n| `api` | **web** |');
    expect(bloco).toMatchObject({
      rows: [[[{ kind: 'code', text: 'api' }], [{ kind: 'bold', text: 'web' }]]],
    });
  });

  it('barra escapada (\\|) fica DENTRO da célula em vez de separar', () => {
    const [bloco] = parseMarkdown('| a | b |\n| --- | --- |\n| x \\| y | z |');
    expect(bloco).toMatchObject({
      rows: [[[{ kind: 'text', text: 'x | y' }], [{ kind: 'text', text: 'z' }]]],
    });
  });

  it('a tabela termina na linha em branco e o texto seguinte volta a ser parágrafo', () => {
    const blocos = parseMarkdown(
      'Segue o mapa:\n| a |\n| --- |\n| 1 |\n\nDepois disso, mais nada.',
    );
    expect(blocos.map((b) => b.type)).toEqual(['paragraph', 'table', 'paragraph']);
  });

  it('tabela só com cabeçalho não quebra — vira table sem linhas', () => {
    const [bloco] = parseMarkdown('| a | b |\n| --- | --- |');
    expect(bloco).toMatchObject({ type: 'table', rows: [] });
  });
});
