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

export interface ResultadoDeRender {
  svg: string;
}

function lerToken(nome: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return valor || fallback;
}

/**
 * Tema do Mermaid a partir dos tokens do design system — nunca cor fixa.
 * Lido a cada render, e não memoizado: é o único momento em que os tokens já
 * estão aplicados ao `<html>` (o Mermaid só carrega quando o componente monta).
 */
function temaMermaid() {
  return {
    background: lerToken('--surface-0', '#0a2e3d'),
    primaryColor: lerToken('--surface-2', '#123f4e'),
    primaryTextColor: lerToken('--text-primary', '#f5ede0'),
    primaryBorderColor: lerToken('--border-strong', '#2e6072'),
    lineColor: lerToken('--border-strong', '#2e6072'),
    secondaryColor: lerToken('--surface-1', '#0e3d38'),
    secondaryTextColor: lerToken('--text-primary', '#f5ede0'),
    secondaryBorderColor: lerToken('--border', '#1c4a5a'),
    tertiaryColor: lerToken('--surface-2', '#123f4e'),
    tertiaryTextColor: lerToken('--text-primary', '#f5ede0'),
    tertiaryBorderColor: lerToken('--border', '#1c4a5a'),
    textColor: lerToken('--text-primary', '#f5ede0'),
    personBorder: lerToken('--teal-400', '#2a9d8f'),
    personBkg: lerToken('--teal-600', '#185e56'),
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
