import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lerCor, lerTokens, resolverToken } from './contraste';
import { lerTokenDoTema, TOKENS_PADRAO, type TokenComPadrao } from './tokens-padrao';

const css = readFileSync(resolve(process.cwd(), '../../design/tokens.css'), 'utf8');
const raiz = lerTokens(css, ':root');

describe('TOKENS_PADRAO é o :root de design/tokens.css, não uma cópia que envelhece', () => {
  for (const [nome, padrao] of Object.entries(TOKENS_PADRAO)) {
    it(`${nome} = ${padrao}`, () => {
      if (lerCor(padrao) === null) {
        // Token que não é cor (a fonte do xterm): compara o texto declarado.
        expect(raiz[nome], `${nome}: o padrão do runtime divergiu do tokens.css`).toBe(padrao);
        return;
      }
      const resolvido = resolverToken(nome, raiz);
      expect(resolvido, `${nome} não resolve no :root`).not.toBeNull();
      expect(lerCor(padrao), `${nome}: o padrão do runtime divergiu do tokens.css`).toEqual(resolvido);
    });
  }

  it('nenhum padrão aponta para a paleta bruta nem para o petróleo de antes do ADR 0181', () => {
    // As cores que o Mermaid/xterm/minimapa usavam como fallback até a AT-284.
    const antigos = ['#0a2e3d', '#123f4e', '#f5ede0', '#2e6072', '#1c4a5a', '#2a9d8f', '#185e56', '#03141b'];
    for (const valor of Object.values(TOKENS_PADRAO)) {
      expect(antigos).not.toContain(valor.toLowerCase());
    }
  });
});

describe('lerTokenDoTema', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--accent');
  });

  it('caminho feliz: devolve o valor do tema ativo quando o token resolve', () => {
    document.documentElement.style.setProperty('--accent', '#a4502c');
    expect(lerTokenDoTema('--accent')).toBe('#a4502c');
  });

  it('falha: token que não resolve (folha não aplicada, jsdom) cai no padrão do tema primário', () => {
    expect(lerTokenDoTema('--code-bg')).toBe(TOKENS_PADRAO['--code-bg']);
  });

  it('lê do elemento pedido, não só do <html>', () => {
    const el = document.createElement('div');
    el.style.setProperty('--syntax-keyword', '#123456');
    document.body.appendChild(el);
    expect(lerTokenDoTema('--syntax-keyword' as TokenComPadrao, el)).toBe('#123456');
    el.remove();
  });
});
