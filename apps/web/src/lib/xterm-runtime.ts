/**
 * Único ponto de contato com `@xterm/xterm` + `@xterm/addon-fit` —
 * dependências de RUNTIME novas (ver `TerminalPanel.tsx` pro porquê). Mesmo
 * seam de `mermaid-render.ts`, e pelos DOIS mesmos motivos:
 *
 * 1. `import()` dinâmico: quem nunca abre a aba Terminal não paga o bundle.
 * 2. Testabilidade: mockar um módulo LOCAL é determinístico; mockar
 *    `@xterm/xterm` direto atrás de um `import()` dinâmico dá corrida entre
 *    o mock e a pré-otimização do Vite (a mesma observada nos testes de
 *    `C4DiagramView` contra `mermaid` cru) — o seam evita o problema inteiro.
 */
import type { Terminal, ITerminalOptions } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

export interface XtermInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
}

/** Cria o terminal já com o `FitAddon` carregado — `TerminalPanel` só chama `.open()`/`.fit()`. */
export async function createXtermTerminal(
  opcoes: ITerminalOptions,
): Promise<XtermInstance> {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
  ]);
  const terminal = new Terminal(opcoes);
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  return { terminal, fitAddon };
}
