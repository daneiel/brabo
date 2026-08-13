import { describe, expect, it } from 'vitest';
import { highlightFile, highlightLine, linguagemPorCaminho } from './highlight';

describe('linguagemPorCaminho', () => {
  it('extrai a extensão em minúsculo', () => {
    expect(linguagemPorCaminho('apps/api/src/main.ts')).toBe('ts');
    expect(linguagemPorCaminho('README.MD')).toBe('md');
  });

  it('sem extensão devolve vazio, e o vazio cai no dialeto default', () => {
    expect(linguagemPorCaminho('Makefile')).toBe('');
  });
});

describe('highlightLine — caminho feliz', () => {
  it('reconhece keyword, string, número e identificador seguido de "(" como função', () => {
    const { tokens } = highlightLine(
      "const x = fetchUser(42, 'ok');",
      'ts',
    );
    const kinds = tokens.filter((t) => t.text.trim()).map((t) => `${t.text}:${t.kind}`);

    expect(kinds).toContain('const:keyword');
    expect(kinds).toContain('fetchUser:function');
    expect(kinds).toContain('42:number');
    expect(kinds).toContain("'ok':string");
  });

  it('junta os tokens de volta na linha original — nenhum caractere se perde', () => {
    const linha = '  return a.b(c) + 1; // nota';
    const { tokens } = highlightLine(linha, 'ts');
    expect(tokens.map((t) => t.text).join('')).toBe(linha);
  });

  it('comentário de linha (`//`) consome o resto da linha inteira', () => {
    const { tokens } = highlightLine('x = 1 // comentário', 'ts');
    const ultimo = tokens[tokens.length - 1];
    expect(ultimo.kind).toBe('comment');
    expect(ultimo.text).toBe('// comentário');
  });

  it('`#` é comentário em Python, não em TypeScript', () => {
    const py = highlightLine('x = 1 # nota', 'py');
    expect(py.tokens[py.tokens.length - 1].kind).toBe('comment');

    // Em TS, "#" não é o comentário da linguagem — não deve varrer o resto.
    const ts = highlightLine('x = 1 # nota', 'ts');
    expect(ts.tokens.some((t) => t.kind === 'comment')).toBe(false);
  });

  it('tipo conhecido (string/number/Promise) vira "type", não "text"', () => {
    const { tokens } = highlightLine('function f(): Promise<number> {}', 'ts');
    const kinds = tokens.map((t) => `${t.text}:${t.kind}`);
    expect(kinds).toContain('Promise:type');
    expect(kinds).toContain('number:type');
  });
});

describe('highlightLine — comentário de bloco entre linhas', () => {
  it('abre num "/*" sem "*/" na mesma linha, e a PRÓXIMA linha nasce dentro do comentário', () => {
    const l1 = highlightLine('/* início', 'ts');
    expect(l1.comentarioDeBloco).toBe(true);
    expect(l1.tokens.every((t) => t.kind === 'comment')).toBe(true);

    const l2 = highlightLine('ainda comentário', 'ts', l1.comentarioDeBloco);
    expect(l2.tokens.every((t) => t.kind === 'comment')).toBe(true);
    expect(l2.comentarioDeBloco).toBe(true);
  });

  it('fecha no "*/" e o que vem depois na mesma linha volta a ser código', () => {
    const l2 = highlightLine('fim */ const x = 1;', 'ts', true);
    expect(l2.comentarioDeBloco).toBe(false);
    const depois = l2.tokens.find((t) => t.text === 'const');
    expect(depois?.kind).toBe('keyword');
  });

  it('Python não suporta bloco: um "/*" solto é só texto, nunca vira comentário de bloco', () => {
    const { comentarioDeBloco, tokens } = highlightLine('x = 1 / 2 * 3', 'py');
    expect(comentarioDeBloco).toBe(false);
    expect(tokens.some((t) => t.kind === 'comment')).toBe(false);
  });
});

// RN-158: vocabulário PRÓPRIO de shell — antes `sh`/`bash` só tinham o
// comentário de linha (`#`) mapeado, e caíam no fallback de JS
// (PALAVRAS_BASE) pra keyword, que não conhece `fi`/`done`/`esac`/`local`.
describe('highlightLine — vocabulário de shell (RN-158)', () => {
  it('palavras REAIS de shell (sem equivalente em JS) viram keyword em sh e bash', () => {
    for (const lang of ['sh', 'bash']) {
      const { tokens } = highlightLine('if [ -f x ]; then echo ok; fi', lang);
      const kinds = tokens.filter((t) => t.text.trim()).map((t) => `${t.text}:${t.kind}`);
      expect(kinds).toContain('if:keyword');
      expect(kinds).toContain('then:keyword');
      expect(kinds).toContain('echo:keyword');
      expect(kinds).toContain('fi:keyword');
    }
  });

  it('`#` continua sendo o comentário de linha em sh/bash', () => {
    const { tokens } = highlightLine('echo ok # nota', 'bash');
    expect(tokens[tokens.length - 1]).toEqual({ text: '# nota', kind: 'comment' });
  });
});

describe('highlightFile', () => {
  it('devolve uma linha de tokens por linha do conteúdo, carregando o estado de bloco', () => {
    const conteudo = ['/* a', 'b', 'c */ const x = 1;'].join('\n');
    const linhas = highlightFile(conteudo, 'ts');

    expect(linhas).toHaveLength(3);
    expect(linhas[0].every((t) => t.kind === 'comment')).toBe(true);
    expect(linhas[1].every((t) => t.kind === 'comment')).toBe(true);
    expect(linhas[2].some((t) => t.kind === 'keyword')).toBe(true);
  });

  it('arquivo vazio devolve uma linha vazia (join/split de "" produz [""])', () => {
    expect(highlightFile('', 'ts')).toHaveLength(1);
  });
});
