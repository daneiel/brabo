/**
 * O leitor PRÓPRIO do lado mestre do PTY, para quando o runner roda sob o Bun
 * — o binário standalone do `bun build --compile` (ADR 0112). AT-342.
 *
 * O defeito, MEDIDO: o `node-pty` lê o mestre com `new tty.ReadStream(fd)`, e
 * o fd é NÃO-BLOQUEANTE (o C++ dele o abre assim). Sob o Node, `tty.ReadStream`
 * é um `net.Socket` sobre o libuv, e o `EAGAIN` de "ainda não há dados" nunca
 * sobe. Sob o Bun, `tty.ReadStream` é um `fs.ReadStream` (o construtor mostra
 * isso), e a primeira leitura sem dados SOBE como erro `EAGAIN`: o `node-pty`
 * engole o erro, mas o stream já se DESTRUIU — `close`, o fd fechado junto
 * (autoClose), e nenhum `onData` depois disso. Medido em Linux x64 com o Bun
 * 1.3.11, `node-pty` 1.1.0 e `/bin/cat`: escrevendo 200 ms depois do spawn,
 * ZERO chunks sob o Bun (`socket error EAGAIN`, `socket close`) e três sob o
 * Node. É o oven-sh/bun#25822 (aberto; a correção proposta, PR #41495, troca o
 * `tty.ReadStream` do Bun por um handle nativo e ainda não entrou).
 *
 * Por que isso aparecia SÓ no macOS: o auto-teste escrevia logo depois do
 * spawn, e no Linux a PRIMEIRA leitura já encontrava o eco do terminal E a
 * resposta do `cat` juntos — o round-trip completava antes do primeiro
 * `EAGAIN`. No `macos-14` a primeira leitura pegou só o eco
 * (`saida="SELF_TEST_PTY_MARKER\r\n"`), a segunda deu `EAGAIN`, e o stream
 * morreu. Ou seja: o terminal interativo do binário estava quebrado nas TRÊS
 * plataformas Unix depois do primeiro pedaço de saída; o Linux passava na
 * prova por sorte de tempo. Por isso o auto-teste agora faz uma SEGUNDA volta
 * depois de uma pausa (ver `rodarAutoTestePty` em `index.ts`).
 *
 * O contorno: durante o `spawn`, o `tty.ReadStream` que o `node-pty` enxerga
 * é trocado por `LeitorDeFdNaoBloqueante` — um `Readable` que lê o MESMO fd
 * com `fs.read` e, no `EAGAIN`, ESPERA e tenta de novo, em vez de morrer. O fd
 * continua sendo o do PTY de verdade, o processo filho continua sendo o de
 * verdade: nada aqui simula saída. O preço é de latência e de CPU, e é
 * declarado: sem integração com o laço de eventos, o leitor consulta o fd
 * ocioso a cada `ESPERA_MAXIMA_MS` no pior caso (a espera dobra de
 * `ESPERA_MINIMA_MS` até lá e volta ao mínimo a cada dado).
 *
 * Só se aplica sob o Bun e fora do Windows (`precisaDoLeitorProprio`): sob o
 * Node o `tty.ReadStream` funciona e não se toca nele, e no Windows o
 * `node-pty` não usa `tty.ReadStream` (é o ConPTY, sobre pipes nomeados).
 */

import { close as fecharFd, read as lerFd } from 'node:fs';
import { Readable } from 'node:stream';
import tty from 'node:tty';
import type { NodePtyModule } from './pty.ts';

export const ESPERA_MINIMA_MS = 4;
export const ESPERA_MAXIMA_MS = 32;
const TAMANHO_DA_LEITURA = 64 * 1024;

/** Os campos do ambiente que decidem — injetáveis para o teste. */
export interface AmbienteDoLeitor {
  versaoDoBun: string | undefined;
  plataforma: NodeJS.Platform;
}

export function ambienteAtual(): AmbienteDoLeitor {
  return { versaoDoBun: process.versions.bun, plataforma: process.platform };
}

export function precisaDoLeitorProprio(ambiente: AmbienteDoLeitor): boolean {
  return ambiente.versaoDoBun !== undefined && ambiente.plataforma !== 'win32';
}

/**
 * Lê um fd NÃO-bloqueante de verdade, tratando `EAGAIN`/`EWOULDBLOCK` como
 * "ainda não" (espera e tenta de novo) e `EIO`/zero bytes como fim — `EIO` é
 * o que o mestre devolve no Linux quando o último processo do lado escravo
 * sai, e o `node-pty` já tratava assim.
 */
export class LeitorDeFdNaoBloqueante extends Readable {
  private readonly fd: number;
  private readonly buffer = Buffer.alloc(TAMANHO_DA_LEITURA);
  private lendo = false;
  private espera = ESPERA_MINIMA_MS;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private fdFechado = false;

  constructor(fd: number) {
    super();
    this.fd = fd;
  }

  override _read(): void {
    this.lerAgora();
  }

  private lerAgora(): void {
    if (this.lendo || this.destroyed || this.temporizador) return;
    this.lendo = true;
    lerFd(this.fd, this.buffer, 0, this.buffer.length, null, (erro, bytes) => {
      this.lendo = false;
      if (this.destroyed) return;
      if (erro) {
        const codigo = (erro as NodeJS.ErrnoException).code;
        if (codigo === 'EAGAIN' || codigo === 'EWOULDBLOCK') {
          this.agendar();
          return;
        }
        if (codigo === 'EIO') {
          this.push(null);
          return;
        }
        this.destroy(erro);
        return;
      }
      if (bytes === 0) {
        this.push(null);
        return;
      }
      this.espera = ESPERA_MINIMA_MS;
      if (this.push(Buffer.from(this.buffer.subarray(0, bytes)))) this.lerAgora();
    });
  }

  private agendar(): void {
    const espera = this.espera;
    this.espera = Math.min(this.espera * 2, ESPERA_MAXIMA_MS);
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      this.lerAgora();
    }, espera);
  }

  override _destroy(erro: Error | null, feito: (erro?: Error | null) => void): void {
    if (this.temporizador) {
      clearTimeout(this.temporizador);
      this.temporizador = null;
    }
    // Como o `tty.ReadStream` do Node: destruir fecha o fd do mestre. Uma vez
    // só — o `node-pty` pode destruir depois de o fim já ter destruído.
    if (this.fdFechado) {
      feito(erro);
      return;
    }
    this.fdFechado = true;
    fecharFd(this.fd, () => feito(erro));
  }
}

/** O objeto de módulo `tty` que o `node-pty` lê (`var tty = require("tty")`). */
interface ModuloTty {
  ReadStream: unknown;
}

/**
 * Devolve o `node-pty` com o `spawn` embrulhado: durante a chamada, o
 * `tty.ReadStream` do módulo `tty` é `LeitorDeFdNaoBloqueante`, e é restaurado
 * no `finally` — o construtor só é lido ali dentro (`new tty.ReadStream(term.fd)`
 * em `lib/unixTerminal.js`). Fora do ambiente que precisa, devolve o módulo
 * INTACTO, o mesmo objeto.
 */
export function comLeitorDePtyProprio(
  nodePty: NodePtyModule,
  ambiente: AmbienteDoLeitor = ambienteAtual(),
  moduloTty: ModuloTty = tty as unknown as ModuloTty,
): NodePtyModule {
  if (!precisaDoLeitorProprio(ambiente)) return nodePty;
  const spawnOriginal = nodePty.spawn.bind(nodePty);
  const spawn: NodePtyModule['spawn'] = (arquivo, argumentos, opcoes) => {
    const original = moduloTty.ReadStream;
    moduloTty.ReadStream = LeitorDeFdNaoBloqueante;
    try {
      return spawnOriginal(arquivo, argumentos, opcoes);
    } finally {
      moduloTty.ReadStream = original;
    }
  };
  return { ...nodePty, spawn };
}
