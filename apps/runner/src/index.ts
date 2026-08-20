#!/usr/bin/env node
/**
 * `brabo-runner` — CLI que executa, na máquina do próprio usuário, os
 * comandos que os agentes propõem e que o pipeline de aprovação do produto
 * já aprovou. NÃO decide política nenhuma: só executa o que chega pelo
 * canal já aprovado, no espírito de `Engine.Actions.TerminalExecutor`
 * (o executor de HOJE, que roda em container) — este é o mesmo contrato,
 * só que executando fora do container, na máquina do usuário.
 *
 * uso: brabo-runner --project <projectId> --dir <caminho-absoluto> [--api-url <url>]
 *
 * Ver o docblock de cada módulo para o desenho de cada parte:
 * `auth.ts` (autenticação + ticket), `channel.ts` (protocolo Phoenix),
 * `exec.ts` (execução não-interativa), `pty.ts` (terminal interativo),
 * `guard.ts` (barreira best-effort de `cwd`), `fs-browser.ts` (navegação
 * de pasta local, sem a barreira de `guard.ts` — ver o docblock dele).
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { obterAccessToken, obterTicketDoRunner } from './auth.ts';
import {
  conectarCanal,
  enviarExecResult,
  enviarFsHomeDirReply,
  enviarFsListDirReply,
  enviarPtyData,
  enviarPtyError,
  enviarPtyOpened,
  JoinRecusadoError,
  type ChannelLike,
  type ExecMessage,
  type FsHomeDirMessage,
  type FsListDirMessage,
  type PtyOpenMessage,
} from './channel.ts';
import { executarComando } from './exec.ts';
import { diretorioInicial, listarDiretorio } from './fs-browser.ts';
import { CwdForaDaRaizError, validarCwdDentroDaRaiz } from './guard.ts';
import { GerenciadorDePty } from './pty.ts';

interface Argumentos {
  projectId: string;
  dir: string;
  apiUrl: string;
}

function uso(): never {
  console.error(
    'uso: brabo-runner --project <projectId> --dir <caminho-absoluto> [--api-url <url>]',
  );
  console.error(
    'Autenticação: BRABO_ACCOUNT_TOKEN no ambiente, ou login interativo na primeira execução ' +
      '(credenciais renovadas depois via ~/.brabo/runner-credentials.json).',
  );
  process.exit(2);
}

function lerArgumentos(argv: string[]): Argumentos {
  const args = argv.slice(2);
  const valorDe = (flag: string): string | undefined => {
    const indice = args.indexOf(flag);
    if (indice < 0) return undefined;
    return args[indice + 1];
  };

  const projectId = valorDe('--project');
  const dirBruto = valorDe('--dir');
  const apiUrl = valorDe('--api-url') ?? process.env.BRABO_API_URL ?? 'http://localhost:3000';

  if (!projectId || projectId.startsWith('--')) uso();
  if (!dirBruto || dirBruto.startsWith('--')) uso();

  const dir = resolve(dirBruto);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`--dir precisa ser uma pasta existente. Recebido: ${dirBruto}`);
    process.exit(2);
  }

  return { projectId, dir, apiUrl };
}

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Mesma forma de backoff de `apps/web/src/lib/session-channel.ts`. */
function esperaDaTentativa(tentativa: number): number {
  return [1_000, 2_000, 5_000, 10_000][tentativa - 1] ?? 30_000;
}

/**
 * Teto de tentativas SEGUIDAS sem sucesso (ticket, join por motivo
 * transitório, etc.) antes de desistir de vez. Existe para o runner não
 * martelar a api/engine para sempre quando o problema não é transitório
 * (api fora do ar por longo tempo, por exemplo) — quem quiser continuar
 * tentando roda o processo de novo. Zerado a cada conexão bem-sucedida.
 */
const TETO_DE_TENTATIVAS_SEGUIDAS = 10;

/** Handlers de `exec`/PTY — dependem do canal ATUAL, guardado num holder mutável
 * porque `conectarCanal` só devolve o canal DEPOIS de já ter passado os
 * handlers (o mesmo problema resolvido no teste de `channel.spec.ts`). */
interface EstadoDoRunner {
  canalAtual: ChannelLike | null;
  dir: string;
  gerenciadorPty: GerenciadorDePty;
}

async function tratarExec(estado: EstadoDoRunner, msg: ExecMessage): Promise<void> {
  const canal = estado.canalAtual;
  if (!canal) return; // conexão caiu entre o recebimento e o tratamento — nada a responder

  let cwd: string;
  try {
    cwd = validarCwdDentroDaRaiz(msg.cwd, estado.dir);
  } catch (erro) {
    // Responde com falha explícita — nunca deixa o servidor esperando por
    // um `exec_result` que nunca chega (ver guard.ts: best-effort, mas o
    // que ela recusa precisa ser COMUNICADO, não engolido).
    const explicacao =
      erro instanceof CwdForaDaRaizError ? erro.message : mensagemDeErro(erro);
    enviarExecResult(canal, {
      ref: msg.ref,
      exitCode: -1,
      output: `[runner recusou o comando: ${explicacao}]`,
      timedOut: false,
    });
    return;
  }

  console.log(`exec ${msg.ref}: ${msg.command} (cwd=${cwd})`);
  const resultado = await executarComando(msg.command, cwd);
  console.log(
    `exec ${msg.ref}: exit=${resultado.exitCode} timedOut=${resultado.timedOut} ` +
      `bytes=${resultado.output.length}`,
  );

  // O canal pode ter caído ENQUANTO o comando rodava — reconfere antes de
  // empurrar, e não perde o resultado silenciosamente: fica só no log local.
  if (estado.canalAtual !== canal) {
    console.warn(`exec ${msg.ref}: canal caiu antes do resultado ser entregue`);
    return;
  }
  enviarExecResult(canal, { ref: msg.ref, ...resultado });
}

function tratarPtyOpen(estado: EstadoDoRunner, msg: PtyOpenMessage): void {
  const canal = estado.canalAtual;
  if (!canal) return;

  const resultado = estado.gerenciadorPty.abrir(msg.sessionRef, msg.cols, msg.rows);
  if (resultado.ok) {
    enviarPtyOpened(canal, { sessionRef: msg.sessionRef });
  } else {
    enviarPtyError(canal, { sessionRef: msg.sessionRef, message: resultado.message });
  }
}

async function tratarFsListDir(estado: EstadoDoRunner, msg: FsListDirMessage): Promise<void> {
  const canal = estado.canalAtual;
  if (!canal) return;

  const resultado = await listarDiretorio(msg.path);

  // Canal pode ter caído enquanto listava — não perde silenciosamente, só
  // não empurra pra um canal que já não existe mais.
  if (estado.canalAtual !== canal) return;
  enviarFsListDirReply(canal, { ref: msg.ref, ...resultado });
}

function tratarFsHomeDir(estado: EstadoDoRunner, msg: FsHomeDirMessage): void {
  const canal = estado.canalAtual;
  if (!canal) return;

  enviarFsHomeDirReply(canal, { ref: msg.ref, path: diretorioInicial() });
}

/**
 * Uma "rodada" de conexão: obtém token+ticket FRESCOS, entra no canal, e só
 * volta quando a conexão cai (ou lança se o join for recusado/não puder
 * conectar). O `while` de `main()` decide o que fazer com o retorno/erro —
 * este helper não decide política de retry.
 */
async function conectarERodar(
  apiUrl: string,
  projectId: string,
  estado: EstadoDoRunner,
  deveParar: () => boolean,
): Promise<void> {
  const accessToken = await obterAccessToken(apiUrl);
  const ticket = await obterTicketDoRunner(apiUrl, projectId, accessToken);

  let resolverQueda: () => void;
  const queda = new Promise<void>((res) => {
    resolverQueda = res;
  });

  const conexao = await conectarCanal({
    engineWsUrl: ticket.engineWsUrl,
    ticket: ticket.ticket,
    projectId,
    handlers: {
      onExec: (msg) => void tratarExec(estado, msg),
      onPtyOpen: (msg) => tratarPtyOpen(estado, msg),
      onPtyInput: (msg) => estado.gerenciadorPty.escrever(msg.sessionRef, msg.data),
      onPtyResize: (msg) =>
        estado.gerenciadorPty.redimensionar(msg.sessionRef, msg.cols, msg.rows),
      onPtyClose: (msg) => estado.gerenciadorPty.fechar(msg.sessionRef),
      onFsListDir: (msg) => void tratarFsListDir(estado, msg),
      onFsHomeDir: (msg) => tratarFsHomeDir(estado, msg),
      onDisconnected: () => resolverQueda(),
    },
  });

  estado.canalAtual = conexao.channel;
  console.log(`conectado ao projeto ${projectId} — aguardando comandos aprovados...`);

  await queda;
  estado.canalAtual = null;
  if (!deveParar()) {
    console.warn('conexão com o engine caiu — pedindo ticket novo e reconectando...');
  }
}

async function main(): Promise<void> {
  const { projectId, dir, apiUrl } = lerArgumentos(process.argv);

  console.log(`brabo-runner — projeto ${projectId}, raiz ${dir}, api ${apiUrl}`);

  const estado: EstadoDoRunner = {
    canalAtual: null,
    dir,
    gerenciadorPty: new GerenciadorDePty(
      dir,
      (sessionRef, dataBase64) => {
        if (estado.canalAtual) {
          enviarPtyData(estado.canalAtual, { sessionRef, data: dataBase64 });
        }
      },
      (sessionRef) => {
        // O processo do PTY morreu sozinho (shell encerrado, `exit`, etc.).
        // O contrato não tem evento próprio para isso — o `pty_close` é
        // sempre INICIADO pelo servidor; aqui só liberamos o recurso local
        // (já feito em `GerenciadorDePty.abrir`'s `onExit`) e registramos.
        console.log(`pty ${sessionRef}: processo encerrado`);
      },
    ),
  };

  let parando = false;
  const deveParar = () => parando;

  function encerrar(sinal: string): void {
    if (parando) return;
    parando = true;
    console.log(`\n${sinal} recebido — encerrando o runner...`);
    estado.gerenciadorPty.fecharTodas();
    process.exit(0);
  }
  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));

  let tentativasSeguidas = 0;

  while (!parando) {
    try {
      await conectarERodar(apiUrl, projectId, estado, deveParar);
      tentativasSeguidas = 0; // ficou conectado por um tempo — reseta o contador de falhas
    } catch (erro) {
      if (erro instanceof JoinRecusadoError) {
        // Recusa não é transitória (ticket inválido, outro runner já
        // conectado neste projeto) — encerra com mensagem clara, SEM laço
        // automático. Só um novo `brabo-runner` (ação humana) tenta de novo.
        console.error(erro.message);
        process.exit(1);
      }

      console.error(`falha na conexão: ${mensagemDeErro(erro)}`);
      tentativasSeguidas++;
      if (tentativasSeguidas > TETO_DE_TENTATIVAS_SEGUIDAS) {
        console.error(
          `${TETO_DE_TENTATIVAS_SEGUIDAS} tentativas seguidas sem sucesso — desistindo. ` +
            'Rode o runner de novo quando o problema estiver corrigido.',
        );
        process.exit(1);
      }
      const espera = esperaDaTentativa(tentativasSeguidas);
      console.error(`tentando de novo em ${espera}ms...`);
      await esperar(espera);
    }
  }
}

// Só roda `main()` quando executado diretamente como CLI (`brabo-runner` ou
// `node src/index.ts`) — nunca em `import` (ex.: se algum teste um dia
// importar deste arquivo).
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('brabo-runner')) {
  main().catch((erro) => {
    console.error(`falha fatal: ${mensagemDeErro(erro)}`);
    process.exit(1);
  });
}
