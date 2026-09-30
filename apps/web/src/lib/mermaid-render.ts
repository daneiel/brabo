/**
 * Único ponto de contato com o pacote `mermaid` — dependência de RUNTIME
 * nova (primeira do app React; o site de docs já usa Mermaid, mas em
 * build-time). Isolado num módulo próprio por duas razões:
 *
 * 1. `import()` dinâmico: quem nunca abre a Visão Geral com um diagrama C4
 *    gerado não paga o bundle do Mermaid (pesado — dezenas de KB).
 * 2. Testabilidade: mockar um módulo LOCAL (`vi.mock('../lib/mermaid-render')`)
 *    é determinístico; mockar o pacote `mermaid` direto por trás de um
 *    `import()` dinâmico dá corrida entre o mock e a pré-otimização do Vite
 *    (observado nos testes de `C4DiagramView`) — o seam evita o problema
 *    inteiro, e não só no teste: qualquer chamador ganha um ponto único pra
 *    trocar de motor de diagrama no futuro.
 */

import { lerTokenDoTema } from './tokens-padrao';

export interface ResultadoDeRender {
  svg: string;
}

/**
 * Tema do Mermaid a partir dos tokens do design system — nunca cor fixa.
 * Lido a cada render, e não memoizado: é o único momento em que os tokens já
 * estão aplicados ao `<html>` (o Mermaid só carrega quando o componente monta).
 *
 * O padrão de quando o token não resolve vem de `TOKENS_PADRAO` (AT-284, ADR
 * 0181), conferido contra `design/tokens.css` por teste — eram 14 hex soltos
 * aqui, no azul-petróleo de antes. O "person" do C4 usava a paleta BRUTA
 * (`--teal-400`/`--teal-600`), que não muda com o tema; passou ao acento sobre
 * a superfície de card, que muda.
 */
function temaMermaid() {
  return {
    background: lerTokenDoTema('--surface-0'),
    primaryColor: lerTokenDoTema('--surface-2'),
    primaryTextColor: lerTokenDoTema('--text-primary'),
    primaryBorderColor: lerTokenDoTema('--border-strong'),
    lineColor: lerTokenDoTema('--border-strong'),
    secondaryColor: lerTokenDoTema('--surface-1'),
    secondaryTextColor: lerTokenDoTema('--text-primary'),
    secondaryBorderColor: lerTokenDoTema('--border'),
    tertiaryColor: lerTokenDoTema('--surface-2'),
    tertiaryTextColor: lerTokenDoTema('--text-primary'),
    tertiaryBorderColor: lerTokenDoTema('--border'),
    textColor: lerTokenDoTema('--text-primary'),
    personBorder: lerTokenDoTema('--accent'),
    personBkg: lerTokenDoTema('--surface-1'),
  };
}

/**
 * Renderiza sintaxe Mermaid para SVG (string). Lança em sintaxe inválida — o
 * chamador decide o que fazer com o erro (`C4DiagramView` mostra um Alert e
 * a sintaxe crua, nunca deixa a exceção subir pra tela — RN-088).
 */
export async function renderMermaid(id: string, sintaxe: string): Promise<ResultadoDeRender> {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: temaMermaid(),
  });
  return mermaid.render(id, sintaxe);
}
