import { useEffect, useRef, useState } from 'react';
import type { Terminal as XTermTerminal } from '@xterm/xterm';
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit';
import { connectTerminalChannel, type TerminalChannel } from '../../lib/terminal-channel';
import { createXtermTerminal } from '../../lib/xterm-runtime';
import { Skeleton } from '../../components/ui/Skeleton';
import { RunnerOnboardingPanel } from '../../components/RunnerOnboardingPanel';
import styles from './TerminalPanel.module.css';

/**
 * O terminal interativo de verdade da aba Code — runner local + PTY (a
 * fronteira que a FASE 25b tinha deixado cortada). Duas frentes PARALELAS
 * constroem o lado servidor (engine+api: canal `terminal:<projectId>`,
 * ticket, relay; e `apps/runner`, o CLI que roda na máquina do usuário);
 * este componente é só o lado WEB — espectador/operador do MESMO canal.
 *
 * ## `@xterm/xterm` + `@xterm/addon-fit`, dependências NOVAS
 *
 * Mesma régua de exceção que o `mermaid` já tem no produto (ADR 0068): um
 * terminal PTY bidirecional não se renderiza com DOM próprio a custo
 * razoável (o `code/highlight.ts` tokeniza texto ESTÁTICO; aqui o conteúdo
 * muda por byte, com cursor, cores ANSI e controle de terminal — reimplementar
 * isso por conta própria seria reescrever o `xterm.js`). `import()` dinâmico
 * pelos mesmos dois motivos de `lib/mermaid-render.ts`: quem nunca abre a aba
 * Terminal não paga o bundle, e o entrypoint eager continua leve.
 *
 * **CSP (ADR 0058, `script-src 'self'`)**: inspecionei o pacote instalado
 * (`node_modules/@xterm/xterm/lib/xterm.js` e `.mjs`, e `@xterm/addon-fit`) —
 * grep por `eval(` e `new Function` não encontrou NENHUMA ocorrência nos dois.
 * Isso é evidência forte de que o renderer DOM padrão (o único que este
 * componente usa; os addons de Canvas/WebGL não entraram) não depende de
 * `eval`, mas não é uma garantia formal contra código minificado que ofusque
 * o padrão de outra forma — a documentação oficial do projeto não afirma
 * "CSP-safe" em lugar nenhum que eu tenha achado. Se a aba falhar sob CSP em
 * produção, é o primeiro lugar a olhar.
 */

type EstadoDoTerminal =
  | { tipo: 'carregando' }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'conectado' };

/** Token do design system, com fallback — mesmo padrão de `mermaid-render.ts`. */
function lerToken(nome: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return valor || fallback;
}

function temaDoXterm() {
  return {
    background: lerToken('--code-bg', '#03141b'),
    foreground: lerToken('--text-primary', '#f5ede0'),
    cursor: lerToken('--accent', '#2a9d8f'),
    cursorAccent: lerToken('--code-bg', '#03141b'),
    selectionBackground: lerToken('--surface-2', '#123f4e'),
  };
}

export function TerminalPanel({ projectId }: { projectId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [estado, setEstado] = useState<EstadoDoTerminal>({ tipo: 'carregando' });
  // Reconsulta a conexão sem fechar/reabrir a aba — o botão "Já instalei,
  // conectar" do RunnerOnboardingPanel incrementa isto, o efeito abaixo
  // reroda por inteiro (mesmo caminho de um remount real).
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let cancelado = false;
    let canal: TerminalChannel | null = null;
    let term: XTermTerminal | null = null;
    let fitAddon: XTermFitAddon | null = null;
    let resizeObserver: ResizeObserver | undefined;
    let dataListener: { dispose: () => void } | null = null;

    setEstado({ tipo: 'carregando' });

    async function montar() {
      const container = containerRef.current;
      if (!container) return;

      const instancia = await createXtermTerminal({
        convertEol: true,
        fontFamily: lerToken('--font-mono', "'IBM Plex Mono', monospace"),
        fontSize: 13,
        cursorBlink: true,
        theme: temaDoXterm(),
      });
      if (cancelado) {
        instancia.terminal.dispose();
        return;
      }

      term = instancia.terminal;
      fitAddon = instancia.fitAddon;
      term.open(container);
      fitAddon.fit();

      // O que o usuário digita vira `pty_input` — só depois que a sessão PTY
      // confirmou abertura faz sentido mandar (antes disso não há processo do
      // outro lado pra receber), mas o listener já pode nascer aqui: o canal
      // enfileira internamente (ver `terminal-channel.ts`).
      dataListener = term.onData((texto) => {
        canal?.enviarInput(texto);
      });

      canal = connectTerminalChannel(projectId, {
        onAberto: () => {
          if (cancelado) return;
          setEstado({ tipo: 'conectado' });
        },
        onErro: (mensagem) => {
          if (cancelado) return;
          setEstado({ tipo: 'erro', mensagem });
        },
        onDados: (texto) => {
          term?.write(texto);
        },
        onDesconectado: () => {
          if (cancelado) return;
          setEstado({
            tipo: 'erro',
            mensagem:
              'A conexão com o runner caiu. Feche e reabra esta aba para tentar de novo.',
          });
        },
      });

      canal.abrirPty(term.cols, term.rows);

      // jsdom não implementa `ResizeObserver` (mesma guarda de
      // `CodeEditor.tsx`/RN-173) — a medição inicial acima já cobre o caso
      // sem ele; o observer só importa quando o PAINEL muda de tamanho depois
      // (o usuário redimensiona a janela, ou o painel inferior é arrastado).
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (!fitAddon || !term || !canal) return;
          fitAddon.fit();
          canal.redimensionar(term.cols, term.rows);
        });
        resizeObserver.observe(container);
      }
    }

    void montar();

    return () => {
      cancelado = true;
      resizeObserver?.disconnect();
      dataListener?.dispose();
      canal?.fechar();
      term?.dispose();
    };
  }, [projectId, tentativa]);

  return (
    <div className={styles.wrapper}>
      {estado.tipo === 'carregando' && (
        <div className={styles.overlay}>
          <Skeleton width={220} height={20} radius={999} />
          <p className={styles.overlayTexto}>Abrindo terminal…</p>
        </div>
      )}

      {estado.tipo === 'erro' && (
        <div className={styles.overlay}>
          <RunnerOnboardingPanel
            projectId={projectId}
            mensagem={estado.mensagem}
            onRetry={() => setTentativa((t) => t + 1)}
          />
        </div>
      )}

      {/* Sempre no DOM (`term.open()` precisa do nó assim que o efeito monta,
          antes de sabermos se vai dar erro ou conectar) e SEMPRE com o
          tamanho real do wrapper — escondido atrás do overlay via
          empilhamento, nunca via `display:none`, porque isso zeraria a
          medição do `FitAddon` enquanto carrega. */}
      <div ref={containerRef} className={styles.terminalMount} />
    </div>
  );
}
