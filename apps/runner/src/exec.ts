/**
 * Execução não-interativa de um comando já aprovado (evento `"exec"` do
 * contrato do runner).
 *
 * Mesma semântica do `Engine.Actions.TerminalExecutor` do lado servidor
 * (`apps/engine/lib/engine/actions/terminal_executor.ex`): `stdout`+`stderr`
 * combinados, timeout que mata o processo, teto de bytes na saída com marca
 * de truncagem clara para quem lê (aqui, o modelo do lado servidor). Os
 * defaults são os MESMOS valores do produto —
 * `TERMINAL_ACTION_TIMEOUT_MS`/`TERMINAL_OUTPUT_MAX_BYTES` — só que aqui não
 * há `Application.get_env`: o runner é processo isolado, então os defaults
 * são literais e configuráveis por parâmetro, nunca por variável de ambiente
 * própria (não há uma sessão de config compartilhada com o engine).
 */

import { spawn } from 'node:child_process';

export const TIMEOUT_PADRAO_MS = 15_000;
export const TETO_DE_BYTES_PADRAO = 32_768;

export interface ExecOpts {
  /** Shell a invocar com `-c <command>`. Default: `$SHELL` do usuário, ou `/bin/sh`. */
  shell?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /**
   * Credencial de git (ADR 0056), estendida ao protocolo `exec`/`exec_result`
   * pela RN-505/ADR 0145. MESCLADO em cima de `process.env` — nunca o
   * substitui: `spawn` com `env` definido descarta o ambiente herdado
   * (PATH incluso), e um `git`/`sh` sem PATH nem resolve o próprio binário.
   * Nunca aparece em `command` (argv) nem em log nenhum — ver `index.ts`.
   */
  env?: Record<string, string>;
}

export interface ExecResult {
  /**
   * `-1` é sentinela de "morto por timeout/sinal, sem código de saída real"
   * — o contrato exige `number` (nunca `null`), e um processo morto por
   * sinal não tem exit code no sentido POSIX. Nenhum comando termina com -1
   * por conta própria, então o sentinela não é ambíguo para quem lê.
   */
  exitCode: number;
  output: string;
  timedOut: boolean;
}

function shellPadrao(): string {
  return process.env.SHELL || '/bin/sh';
}

function marcaDeTruncagem(max: number, totalBytes: number): string {
  return (
    `\n\n[saída truncada: ${max} de ${totalBytes} bytes. ` +
    `Refine o comando (head, grep, -maxdepth) para ver o que falta.]`
  );
}

/**
 * Executa `command` em `cwd` (já validado por `guard.ts` antes de chegar
 * aqui — este módulo não valida caminho, só executa).
 */
export function executarComando(
  command: string,
  cwd: string,
  opts: ExecOpts = {},
): Promise<ExecResult> {
  const shell = opts.shell ?? shellPadrao();
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_PADRAO_MS;
  const maxBytes = opts.maxBytes ?? TETO_DE_BYTES_PADRAO;

  return new Promise((resolvePromise) => {
    const pedacos: Buffer[] = [];
    let bytesArmazenados = 0;
    // Contagem TOTAL, sempre — independente do que é retido em memória. É o
    // que vai na marca de truncagem ("X de Y bytes"): mentir aqui esconderia
    // exatamente o tamanho real da saída, que é o dado que ajuda a refinar o
    // comando (mesmo raciocínio do `raw_bytes` do TerminalExecutor do engine).
    let bytesTotaisReais = 0;
    // Guarda alguma margem além do teto (para a marca de truncagem não
    // precisar cortar de novo o que já é o fim do buffer útil), sem
    // acumular a saída inteira de um comando que produz gigabytes.
    const tetoDeAcumulacao = maxBytes + 4_096;

    const filho = spawn(shell, ['-c', command], {
      cwd,
      // stdin fechado: comando não-interativo não deveria esperar entrada,
      // e deixar herdado prenderia o processo do runner ao terminal dele.
      stdio: ['ignore', 'pipe', 'pipe'],
      // MESCLA, nunca substitui: `spawn` com `env` definido descarta TODO o
      // ambiente herdado (o `undefined` do caminho comum omite `env` da
      // opção, e o Node herda `process.env` sozinho — só quando `opts.env`
      // carrega algo é que `{ ...process.env, ...opts.env }` entra em jogo).
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
    });

    let finalizado = false;
    let timedOut = false;

    const cronometro = setTimeout(() => {
      timedOut = true;
      // SIGTERM primeiro, SIGKILL de reforço — mesma disciplina de dois
      // passos que scripts de operação do produto já usam; a limitação
      // documentada no TerminalExecutor do engine (Erlang não garante matar
      // o processo OS por trás de uma porta) não se aplica aqui: `spawn` do
      // Node devolve o PID real, e `kill()` manda o sinal direto nele.
      filho.kill('SIGTERM');
      setTimeout(() => {
        if (!finalizado) filho.kill('SIGKILL');
      }, 2_000).unref();
    }, timeoutMs);
    cronometro.unref();

    function coletar(chunk: Buffer) {
      bytesTotaisReais += chunk.byteLength;
      if (bytesArmazenados >= tetoDeAcumulacao) return; // já temos o bastante
      pedacos.push(chunk);
      bytesArmazenados += chunk.byteLength;
    }

    filho.stdout?.on('data', coletar);
    filho.stderr?.on('data', coletar);

    filho.on('error', (erro) => {
      finalizado = true;
      clearTimeout(cronometro);
      resolvePromise({
        exitCode: -1,
        output: `[runner: falha ao iniciar o comando: ${erro.message}]`,
        timedOut: false,
      });
    });

    filho.on('close', (codigoDeSaida, sinal) => {
      finalizado = true;
      clearTimeout(cronometro);

      const bruto = Buffer.concat(pedacos);
      const truncado = bytesTotaisReais > maxBytes;
      // Diferente do `TerminalExecutor` do engine (Elixir): `Buffer#toString('utf8')`
      // do Node NUNCA lança em sequência multibyte cortada ao meio — ele
      // substitui pelo caractere de replacement (U+FFFD), que ainda é UTF-8
      // válido e serializa em JSON sem problema. Não há o mesmo risco de
      // binário inválido quebrando a serialização que motivou
      // `cortar_utf8_incompleto` do lado Elixir.
      const corpo = truncado
        ? bruto.subarray(0, maxBytes).toString('utf8')
        : bruto.toString('utf8');
      const output = truncado
        ? corpo + marcaDeTruncagem(maxBytes, bytesTotaisReais)
        : corpo;

      void sinal; // recebido mas não faz parte do contrato de saída
      resolvePromise({
        // Morto por timeout ou por sinal (sem código): sentinela -1.
        exitCode: timedOut || codigoDeSaida === null ? -1 : codigoDeSaida,
        output,
        timedOut,
      });
    });
  });
}
