/**
 * Modo PTY interativo — para a aba "Terminal" do produto na web, relayado
 * pelo engine. Ver o protocolo completo (`pty_open`/`pty_opened`/
 * `pty_error`/`pty_data`/`pty_input`/`pty_resize`/`pty_close`) no docblock de
 * `channel.ts` e no contrato fixado com a R3.
 *
 * `node-pty` é o binding nativo — o mesmo que o VS Code usa para o terminal
 * integrado dele.
 */

import * as nodePty from 'node-pty';

export interface SessaoPty {
  sessionRef: string;
  processo: nodePty.IPty;
}

function shellPadrao(): string {
  return process.env.SHELL || '/bin/sh';
}

/**
 * Gerencia as sessões de PTY abertas por este processo do runner — uma por
 * `sessionRef` que o servidor abrir. Um único runner pode ter mais de uma
 * sessão de terminal viva ao mesmo tempo (várias abas na web, por exemplo).
 */
export class GerenciadorDePty {
  private readonly sessoes = new Map<string, SessaoPty>();
  // Propriedades explícitas, não parameter properties — `erasableSyntaxOnly`
  // (ver tsconfig.json deste pacote) recusa a forma curta.
  private readonly raiz: string;
  private readonly onData: (sessionRef: string, dataBase64: string) => void;
  private readonly onExit: (sessionRef: string) => void;

  constructor(
    raiz: string,
    onData: (sessionRef: string, dataBase64: string) => void,
    onExit: (sessionRef: string) => void,
  ) {
    this.raiz = raiz;
    this.onData = onData;
    this.onExit = onExit;
  }

  /** Devolve `{ok: true}` ou `{ok: false, message}` — nunca lança. */
  abrir(sessionRef: string, cols: number, rows: number): { ok: true } | { ok: false; message: string } {
    if (this.sessoes.has(sessionRef)) {
      return { ok: false, message: `sessão de PTY duplicada: ${sessionRef}` };
    }

    try {
      const processo = nodePty.spawn(shellPadrao(), [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: this.raiz,
        env: process.env as Record<string, string>,
      });

      this.sessoes.set(sessionRef, { sessionRef, processo });

      processo.onData((data: string) => {
        this.onData(sessionRef, Buffer.from(data, 'utf8').toString('base64'));
      });

      processo.onExit(() => {
        this.sessoes.delete(sessionRef);
        this.onExit(sessionRef);
      });

      return { ok: true };
    } catch (erro) {
      return {
        ok: false,
        message: erro instanceof Error ? erro.message : String(erro),
      };
    }
  }

  /** Escreve a entrada do usuário (base64, do jeito que chega em `pty_input`) no PTY. */
  escrever(sessionRef: string, dataBase64: string): void {
    const sessao = this.sessoes.get(sessionRef);
    if (!sessao) return; // sessão já fechada/inexistente — ignora, não é erro do usuário
    sessao.processo.write(Buffer.from(dataBase64, 'base64').toString('utf8'));
  }

  redimensionar(sessionRef: string, cols: number, rows: number): void {
    const sessao = this.sessoes.get(sessionRef);
    sessao?.processo.resize(cols, rows);
  }

  fechar(sessionRef: string): void {
    const sessao = this.sessoes.get(sessionRef);
    if (!sessao) return;
    sessao.processo.kill();
    this.sessoes.delete(sessionRef);
  }

  /** Mata TODAS as sessões vivas — chamado no shutdown do runner. */
  fecharTodas(): void {
    for (const sessionRef of [...this.sessoes.keys()]) this.fechar(sessionRef);
  }
}
