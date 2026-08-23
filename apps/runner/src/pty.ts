/**
 * Modo PTY interativo — para a aba "Terminal" do produto na web, relayado
 * pelo engine. Ver o protocolo completo (`pty_open`/`pty_opened`/
 * `pty_error`/`pty_data`/`pty_input`/`pty_resize`/`pty_close`) no docblock de
 * `channel.ts` e no contrato fixado com a R3.
 *
 * `node-pty` é o binding nativo — o mesmo que o VS Code usa para o terminal
 * integrado dele. O módulo NÃO é mais importado estaticamente aqui — ver
 * `native-pty-loader.ts` para o motivo (o binário standalone do
 * `bun build --compile`, ADR 0109, precisa resolvê-lo em runtime, depois de
 * extrair os arquivos embutidos para um diretório real). `GerenciadorDePty`
 * recebe o módulo já resolvido por injeção, no construtor — `main()` em
 * `index.ts` resolve uma vez só, antes de montar o estado do runner.
 */

import type * as NodePtyNamespace from 'node-pty';

/** O `typeof import('node-pty')` inteiro — só o TIPO, nunca importado em runtime aqui. */
export type NodePtyModule = typeof NodePtyNamespace;

export interface SessaoPty {
  sessionRef: string;
  processo: NodePtyNamespace.IPty;
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
  private readonly nodePty: NodePtyModule;

  constructor(
    raiz: string,
    onData: (sessionRef: string, dataBase64: string) => void,
    onExit: (sessionRef: string) => void,
    nodePty: NodePtyModule,
  ) {
    this.raiz = raiz;
    this.onData = onData;
    this.onExit = onExit;
    this.nodePty = nodePty;
  }

  /** Devolve `{ok: true}` ou `{ok: false, message}` — nunca lança. */
  abrir(sessionRef: string, cols: number, rows: number): { ok: true } | { ok: false; message: string } {
    if (this.sessoes.has(sessionRef)) {
      return { ok: false, message: `sessão de PTY duplicada: ${sessionRef}` };
    }

    try {
      const processo = this.nodePty.spawn(shellPadrao(), [], {
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
