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
 * Também roda SEM NENHUMA flag quando o diretório atual (`cwd`) contém os
 * três arquivos que o fluxo "configurar pasta automaticamente" do navegador
 * grava: o próprio binário, `brabo-runner.config.json` e
 * `brabo-runner-device-key.jwk.json` — ver `device-key.ts`.
 *
 * Ver o docblock de cada módulo para o desenho de cada parte:
 * `auth.ts` (autenticação + ticket), `device-key.ts` (leitura do config/
 * chave local do modo automático), `channel.ts` (protocolo Phoenix),
 * `exec.ts` (execução não-interativa), `pty.ts` (terminal interativo),
 * `guard.ts` (barreira best-effort de `cwd`), `fs-browser.ts` (navegação
 * de pasta local, sem a barreira de `guard.ts` — ver o docblock dele),
 * `espelho-guard.ts` (o laço origem↔destino, irmão de `guard.ts`),
 * `espelho.ts` (a cópia numa direção só, que nunca apaga — ADR 0147, RN-516),
 * `base.ts` (de ONDE vem a base de projetos desta máquina) e `base-guard.ts`
 * (a base e a subpasta de cada projeto dentro dela — ADR 0151, RN-529).
 */

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  obterToken,
  obterTicketDoRunnerComCredencial,
  type CredencialDeAutenticacao,
} from './auth.ts';
import { resolverBaseConsentida } from './base.ts';
import {
  capacidadesDoRunner,
  conectarCanal,
  enviarContainerRemoveResult,
  enviarContainerStartResult,
  enviarContainerStopResult,
  enviarExecResult,
  enviarFsHomeDirReply,
  enviarFsListDirReply,
  enviarMirrorSyncResult,
  enviarPtyData,
  enviarPtyError,
  enviarPtyOpened,
  enviarWorkspaceConfirm,
  enviarWorkspaceCreateResult,
  JoinRecusadoError,
  type ChannelLike,
  type ContainerRemoveMessage,
  type ContainerStartMessage,
  type ContainerStopMessage,
  type ExecMessage,
  type FsHomeDirMessage,
  type FsListDirMessage,
  type MirrorSyncMessage,
  type MirrorSyncResultMessage,
  type PtyOpenMessage,
  type WorkspaceCreateMessage,
} from './channel.ts';
import {
  estadoDaChaveDeDispositivo,
  explicacaoDaChaveRecusada,
  lerChaveDeDispositivo,
  lerConfigLocal,
} from './device-key.ts';
// A porta de Docker MUDOU de casa no ADR 0130 — de `./docker-*.ts` para o
// pacote `@brabo/docker-port`, quando o broker virou o segundo consumidor. Ela
// é `devDependency` de propósito, na mesma prateleira que `phoenix`: o `tsup`
// deixa `dependencies` como `require` externo e EMBUTE devDependency, e o
// pacote publicado no npm não pode carregar um `workspace:*` que ninguém fora
// deste repositório resolve.
import {
  DockerCliAusenteError,
  DockerIndisponivelError,
  DockerViaCli,
  especificacaoValidada,
  nomeDeWorkspaceValidado,
  PONTO_DE_MONTAGEM,
  type DockerPort,
} from '@brabo/docker-port';
import { mesmoCaminho } from './espelho-guard.ts';
import { sincronizarEspelho } from './espelho.ts';
import { executarComando } from './exec.ts';
import { diretorioInicial, listarDiretorio } from './fs-browser.ts';
import {
  CwdForaDaRaizError,
  cwdParaContainer,
  DirForaDoHomeError,
  DirNaoEUmaPastaError,
  garantirDiretorio,
  NaoConsegiuCriarDiretorioError,
  resolverDir,
  validarCwdDentroDaRaiz,
  validarDirDentroDoHomeNoLinux,
} from './guard.ts';
import { carregarNodePty } from './native-pty-loader.ts';
import { criarPastaDoProjeto, CriacaoDePastaRecusadaError } from './pasta-do-projeto.ts';
import { GerenciadorDePty } from './pty.ts';
import {
  desinstalar,
  ehSubcomandoConhecido,
  instalar,
  status as statusDoServico,
  usoDeServico,
  type ContextoDoServico,
  type RespostaDoServico,
} from './servico.ts';
import { sistemaDeServicoReal } from './servico-sistema.ts';

interface Argumentos {
  projectId: string;
  dir: string;
  apiUrl: string;
  credencial: CredencialDeAutenticacao;
  /**
   * A BASE de projetos desta máquina (ADR 0151 ponto 1, RN-529), ou `null` —
   * que é o estado NORMAL, e é o binário legado da RN-514 continuando a
   * funcionar. Ela NÃO substitui `dir`: `dir` é a raiz DESTE projeto, a base é
   * onde uma pasta de projeto NOVA vai nascer. Ver `base-guard.ts` para por
   * que a regra da base não desce para a validação de `--dir`.
   */
  base: string | null;
}

function uso(): never {
  console.error(
    'uso: brabo-runner --project <projectId> --dir <caminho-absoluto> [--api-url <url>] [--token <brb_...>]',
  );
  console.error(
    'modo automático: rode "brabo-runner" SEM NENHUMA flag dentro da pasta que o ' +
      'botão "Configurar pasta automaticamente" (tela do projeto) baixou — ela já ' +
      'traz brabo-runner.config.json e a chave de dispositivo, e --project/--dir/' +
      '--token deixam de ser necessários.',
  );
  console.error(
    '--dir: se a pasta ainda não existir, ela é criada automaticamente (dentro do ' +
      '$HOME no Linux, RN-434/RN-435). Se apontar para um arquivo existente, é erro. ' +
      'Omitida, a raiz é a própria pasta de onde o comando roda.',
  );
  console.error(
    '--base: a pasta desta máquina sob a qual cada projeto é uma SUBPASTA (ADR 0151). ' +
      'Opcional e independente de --dir, que continua sendo a raiz DESTE projeto: a base ' +
      'só decide onde uma pasta de projeto NOVA nasce. Omitida, é lida de ' +
      '$XDG_CONFIG_HOME/brabo/runner.json (senão ~/.config/brabo/runner.json), onde o ' +
      'instalador a grava; sem arquivo e sem flag, o runner roda sem base, como sempre.',
  );
  console.error(
    'Autenticação: --token <brb_...>, ou BRABO_ACCOUNT_TOKEN no ambiente. Gere em ' +
      'Configurações do projeto → Tokens de acesso — nunca gravado em disco por este ' +
      'CLI. Sem token, a chave de dispositivo local (modo automático) é usada.',
  );
  console.error(
    'serviço de usuário: "brabo-runner service install|uninstall|status" instala o runner ' +
      'como systemd --user (Linux) ou LaunchAgent (macOS) — nunca serviço de sistema, nunca ' +
      'root; Windows fora de escopo (ADR 0147 ponto 5).',
  );
  process.exit(2);
}

/**
 * O comando ABSOLUTO que a unit de serviço deve executar — a única coisa sobre
 * a instalação que só `index.ts` sabe responder, porque depende de qual dos
 * três caminhos de distribuição está rodando AGORA (ADR 0103/0106/0112).
 *
 * No binário compilado (`bun build --compile`), `process.execPath` É o binário
 * e `process.argv[1]` é um caminho VIRTUAL de dentro do bundle (`/$bunfs/...`)
 * que não existe no disco — pôr esse caminho numa unit produziria um serviço
 * que nunca sobe. Sob `node`, o comando é `node <script real>`, com
 * `realpathSync` resolvendo o symlink que `npm install -g` cria em
 * `node_modules/.bin/brabo-runner`: o symlink some numa reinstalação, o alvo
 * dele não.
 */
export function comandoDoRunnerParaServico(): string[] {
  const script = process.argv[1];
  if (import.meta.url.includes('/$bunfs/') || !script || script.startsWith('/$bunfs/')) {
    return [process.execPath];
  }
  try {
    return [process.execPath, realpathSync(script)];
  } catch {
    return [process.execPath, script];
  }
}

/**
 * `brabo-runner service <sub>` — despachado ANTES de `lerArgumentos`, porque
 * nenhum dos três subcomandos conecta a nada: exigir credencial e pasta
 * verificada para PERGUNTAR se há um serviço instalado seria impedir
 * justamente quem precisa da resposta. A resolução de projeto e de pasta reusa
 * as funções de sempre (`lerConfigLocal`, `lerChaveDeDispositivo`,
 * `resolverDir`, `validarDirDentroDoHomeNoLinux`) — nenhuma régua nova.
 */
function rodarSubcomandoDeServico(argv: string[]): RespostaDoServico {
  const sub = argv[3];
  if (!ehSubcomandoConhecido(sub)) return usoDeServico();

  const ctx: ContextoDoServico = {
    argv,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    plataforma: process.platform,
    home: homedir(),
    xdgConfigHome: process.env.XDG_CONFIG_HOME ?? null,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    comandoDoRunner: comandoDoRunnerParaServico(),
    path: process.env.PATH ?? '',
    sistema: sistemaDeServicoReal,
  };

  const resolverDirDoServico = (bruto: string, cwd: string): string =>
    resolverDir(bruto, cwd, cwd);

  if (sub === 'install') {
    return instalar(ctx, {
      lerConfig: lerConfigLocal,
      lerChave: lerChaveDeDispositivo,
      resolverDir: resolverDirDoServico,
      validarDir: validarDirDentroDoHomeNoLinux,
    });
  }
  if (sub === 'uninstall') {
    return desinstalar(ctx, { lerConfig: lerConfigLocal, resolverDir: resolverDirDoServico });
  }
  return statusDoServico(ctx, { lerConfig: lerConfigLocal });
}

function lerArgumentos(argv: string[]): Argumentos {
  const args = argv.slice(2);
  const valorDe = (flag: string): string | undefined => {
    const indice = args.indexOf(flag);
    if (indice < 0) return undefined;
    return args[indice + 1];
  };
  const flagInformado = (flag: string): boolean => args.includes(flag);

  // Pasta de onde o usuário DE FATO rodou o comando — mesma base que
  // `resolverDir` usa para `--dir` relativo (ver docblock de guard.ts) — e
  // também onde procuramos `brabo-runner.config.json`/
  // `brabo-runner-device-key.jwk.json` do modo automático: eles vivem NA
  // pasta de onde o comando roda, nunca em `$HOME`/global (ver
  // `device-key.ts`).
  const cwdEfetivo = process.env.INIT_CWD ?? process.cwd();
  const configLocal = lerConfigLocal(cwdEfetivo);
  const chaveLocal = lerChaveDeDispositivo(cwdEfetivo);

  let projectId: string | undefined;
  if (flagInformado('--project')) {
    const valor = valorDe('--project');
    if (!valor || valor.startsWith('--')) uso();
    projectId = valor;
  } else {
    // Flag explícita sempre vence o config local — na ausência dela, o
    // arquivo baixado pelo navegador resolve sozinho.
    projectId = configLocal?.projectId;
  }
  if (!projectId) uso();

  let dirBruto: string;
  if (flagInformado('--dir')) {
    const valor = valorDe('--dir');
    if (!valor || valor.startsWith('--')) uso();
    dirBruto = valor;
  } else {
    // `--dir` deixou de ser obrigatório: sem a flag, a raiz é a própria
    // pasta de onde o comando roda (`cwdEfetivo`) — `resolverDir('.', ...)`
    // resolve exatamente para lá, reusando a mesma lógica de sempre em vez
    // de duplicá-la.
    dirBruto = '.';
  }

  const apiUrlFlag = valorDe('--api-url');
  const apiUrl =
    apiUrlFlag ?? process.env.BRABO_API_URL ?? configLocal?.apiUrl ?? 'http://localhost:3000';
  const tokenFlag = valorDe('--token');

  // `INIT_CWD` é a pasta de onde o usuário de fato digitou o comando —
  // sem ela, `--dir` relativo resolveria contra `process.cwd()`, que
  // `pnpm --filter runner run <script>` REBASEIA para a pasta do pacote
  // (ver docblock de `resolverDir` em guard.ts).
  const dir = resolverDir(dirBruto, process.env.INIT_CWD, process.cwd());

  // RN-434 (ADR 0104): no Linux, o workspace do modo `runner` só pode viver
  // dentro do $HOME do usuário — nunca fora dele (/etc, /root, outra conta
  // em /home, etc.). Fora do Linux a restrição não se aplica. RODA ANTES de
  // `garantirDiretorio` de propósito (RN-435): ela funciona em caminho que
  // ainda não existe, e criar a pasta antes de validar o $HOME reabriria a
  // brecha que a RN-434 fechou.
  try {
    validarDirDentroDoHomeNoLinux(dir, process.platform, homedir());
  } catch (erro) {
    if (erro instanceof DirForaDoHomeError) {
      console.error(erro.message);
      process.exit(2);
    }
    throw erro;
  }

  // RN-435 (ADR 0104): `--dir` que ainda não existe é criado (mkdir -p) em
  // vez de recusado — `--dir` apontando para um ARQUIVO existente continua
  // erro real, nunca sobrescrito silenciosamente.
  try {
    garantirDiretorio(dir);
  } catch (erro) {
    if (erro instanceof DirNaoEUmaPastaError || erro instanceof NaoConsegiuCriarDiretorioError) {
      console.error(erro.message);
      process.exit(2);
    }
    throw erro;
  }

  // A BASE (ADR 0151 ponto 1, RN-529) — DEPOIS de `garantirDiretorio` de
  // propósito: a recusa de laço compara a base contra `dir`, e comparar
  // contra um caminho que ainda não existe deixaria a segunda passada
  // (`realpath`) resolvendo um ancestral em vez da raiz de verdade.
  //
  // A base NÃO participou de nenhuma linha acima, e isso é a decisão, não
  // esquecimento: `--dir` continua validado exatamente como sempre, e estar
  // FORA da base não o invalida (ver o docblock de `base-guard.ts`, que
  // transpõe a proibição escrita em `project-workspaces-root.ts`).
  let baseFlag: string | undefined;
  if (flagInformado('--base')) {
    baseFlag = valorDe('--base');
    if (!baseFlag || baseFlag.startsWith('--')) uso();
  }
  const baseResolvida = resolverBaseConsentida(
    baseFlag,
    homedir(),
    process.env.XDG_CONFIG_HOME ?? null,
    { plataforma: process.platform, home: homedir(), raizDoProjeto: dir },
  );
  let base: string | null = null;
  if (baseResolvida.estado === 'ok') {
    base = baseResolvida.base;
  } else if (baseResolvida.estado === 'recusada') {
    console.error(baseResolvida.mensagem);
    if (baseResolvida.origem === 'flag') {
      // Pedido EXPLÍCITO digitado agora e impossível de honrar — mesma
      // disposição de `--dir` recusado, logo acima.
      process.exit(2);
    }
    // Arquivo gravado pelo instalador. Recusar aqui derrubaria um runner que
    // nem usa a base — mas ficar CALADO seria o defeito que este repositório
    // não aceita, então a recusa é dita e o que se perde é nomeado.
    console.error(
      'Seguindo SEM base: este runner continua atendendo este projeto normalmente, ' +
        'mas não terá onde criar a pasta de um projeto novo.',
    );
  }

  // `--token`/`BRABO_ACCOUNT_TOKEN` sempre vence a chave de dispositivo
  // local quando ambos existem — mesmo critério de "flag explícita vence
  // arquivo local" usado acima para `--project`/`--api-url`.
  const tokenBruto = tokenFlag ?? process.env.BRABO_ACCOUNT_TOKEN;
  let credencial: CredencialDeAutenticacao;
  if (tokenBruto) {
    let token: string;
    try {
      token = obterToken(tokenFlag);
    } catch (erro) {
      console.error(erro instanceof Error ? erro.message : String(erro));
      process.exit(2);
    }
    credencial = { tipo: 'token', token };
  } else if (chaveLocal) {
    credencial = {
      tipo: 'chave-de-dispositivo',
      jwkPrivada: chaveLocal.jwkPrivada,
      deviceKeyId: chaveLocal.deviceKeyId,
    };
  } else {
    // Nem token (flag/env) nem chave de dispositivo local — sem forma
    // nenhuma de autenticar. Mas os dois motivos de não haver chave não são
    // o mesmo problema (RN-475): arquivo AUSENTE é o caso normal de quem
    // roda com flags, e o bloco de `uso()` responde; arquivo PRESENTE e
    // recusado é uma pasta configurada que não serve, e imprimir ali um
    // texto sobre flags manda a pessoa investigar o lado certo do problema
    // (a config) pelo motivo errado.
    const estadoDaChave = estadoDaChaveDeDispositivo(cwdEfetivo);
    if (estadoDaChave === 'json-invalido' || estadoDaChave === 'sem-kid') {
      console.error(explicacaoDaChaveRecusada(estadoDaChave));
      process.exit(2);
    }
    uso();
  }

  return { projectId, dir, apiUrl, credencial, base };
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
/**
 * `containerAtivo` (ADR 0137) — o NOME do container que ESTE runner subiu
 * (`brabo-<workspaceDirName>`), ou `null` sem container. É o que decide, em
 * `tratarExec`, se um comando roda direto no host (comportamento de sempre)
 * ou via `docker exec` — a decisão é INTERNA ao runner, o engine não sabe
 * disso e não precisa saber (`Engine.Actions.TerminalExecutor` já roteia todo
 * comando de projeto `runner` conectado pra cá incondicionalmente).
 */
export interface EstadoDoRunner {
  canalAtual: ChannelLike | null;
  dir: string;
  gerenciadorPty: GerenciadorDePty;
  docker: DockerPort;
  containerAtivo: string | null;
  /**
   * O destino do espelho CONCEDIDO no join desta conexão (ADR 0147 ponto 4,
   * RN-516), ou `null` — que é o estado normal. Vive aqui e em lugar nenhum
   * além: nunca em arquivo de configuração, nunca em variável de ambiente.
   * Um destino global faria o artefato do projeto B aterrissar na pasta do
   * projeto A, e o usuário descobriria isso pelo conteúdo, não por um erro.
   *
   * Zerado quando a conexão cai, junto com `canalAtual`: a concessão é da
   * CONEXÃO, e um destino que sobreviveu à queda seria o servidor afirmando
   * o que este processo já não pode confirmar.
   */
  destinoDoEspelho: string | null;
  /**
   * A BASE de projetos desta máquina (ADR 0151 ponto 1, RN-529), ou `null` —
   * o estado NORMAL. Ao contrário de `destinoDoEspelho`, ela NÃO vem da
   * concessão do join e NÃO é zerada quando a conexão cai: a base é LOCAL,
   * consentida no instalador, e nunca recebida pela rede. É o desenho do
   * broker (ADR 0144) — quem tem a raiz é quem executa, e o que viaja é o
   * SEGMENTO.
   *
   * `dir` continua sendo a raiz DESTE projeto e não deriva daqui: os dois
   * convivem, e um projeto legado fora da base segue válido.
   */
  base: string | null;
}

export async function tratarExec(estado: EstadoDoRunner, msg: ExecMessage): Promise<void> {
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

  // Log NUNCA imprime `msg.env` (RN-507/ADR 0145) — só ref/command/cwd, os
  // mesmos três campos de sempre. A credencial de git só existe no `env` do
  // processo filho que `executarComando` spawna, nunca em texto.
  console.log(`exec ${msg.ref}: ${msg.command} (cwd=${cwd})`);
  // `env` só se aplica ao caminho HOST (`executarComando`/`spawn`) — o
  // container (`docker exec`, via `packages/docker-port`) não tem campo de
  // `env` na operação, de propósito (ADR 0130: sem `-e` livre nenhum). Um
  // `exec` com `env` despachado enquanto este runner tem container ativo
  // ainda roda — só não carrega a credencial; ver o moduledoc de
  // `Engine.Actions.Workspace.RunnerGit` para o que isso implica hoje.
  const resultado = estado.containerAtivo
    ? await executarComandoNoContainer(estado, estado.containerAtivo, msg.command, cwd)
    : await executarComando(msg.command, cwd, { env: msg.env });
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

/**
 * `cwd` chega aqui já validado por `validarCwdDentroDaRaiz` — sempre um
 * caminho de HOST dentro de `estado.dir`. Traduzido pra dentro de
 * `PONTO_DE_MONTAGEM` (`cwdParaContainer`, `guard.ts`) ANTES de sair pro
 * `docker exec`: o container nunca vê um caminho de host.
 */
async function executarComandoNoContainer(
  estado: EstadoDoRunner,
  nomeDoContainer: string,
  command: string,
  cwd: string,
): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
  return estado.docker.exec(nomeDoContainer, {
    comando: command,
    cwd: cwdParaContainer(estado.dir, cwd, PONTO_DE_MONTAGEM),
  });
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
 * `container_start` (ADR 0137) — sobe o container do projeto NA MÁQUINA DO
 * USUÁRIO, com o Docker DELE. `msg.spec` é o que a api compôs
 * (`EspecificacaoDeContainerParaRunner`) MENOS `raizDoProjeto`: este runner
 * enche esse campo sozinho, com `estado.dir` — a raiz JÁ confirmada e
 * validada no startup da CLI (RN-434/435, `guard.ts`); não há segunda
 * validação de "caminho de mount válido" porque o mount É `estado.dir`,
 * ponto (mesmo raciocínio do docblock de `guard.ts`).
 *
 * Qualquer falha — `EspecificacaoInvalidaError` (spec mal formada),
 * `DockerIndisponivelError`/`DockerCliAusenteError` (sem Docker nesta
 * máquina), ou qualquer outra — vira `container_start_result` com
 * `sucesso: false`, nunca uma exceção não tratada que derruba o runner.
 */
export async function tratarContainerStart(
  estado: EstadoDoRunner,
  msg: ContainerStartMessage,
): Promise<void> {
  const canal = estado.canalAtual;
  if (!canal) return;

  try {
    const spec = especificacaoValidada({ ...msg.spec, raizDoProjeto: estado.dir });
    console.log(`container_start ${msg.ref}: subindo ${spec.imagem} em ${estado.dir}`);
    const resultado = await estado.docker.start(spec);

    if (estado.canalAtual !== canal) return; // canal caiu enquanto o Docker subia

    estado.containerAtivo = resultado.nome;
    console.log(
      `container_start ${msg.ref}: container ${resultado.nome} de pé ` +
        `(jaEstavaDePe=${resultado.jaEstavaDePe})`,
    );
    enviarContainerStartResult(canal, {
      ref: msg.ref,
      sucesso: true,
      containerId: resultado.containerId,
      nome: resultado.nome,
      jaEstavaDePe: resultado.jaEstavaDePe,
    });
  } catch (erro) {
    if (estado.canalAtual !== canal) return;
    const explicacao = mensagemDeErro(erro);
    console.warn(`container_start ${msg.ref}: recusado — ${explicacao}`);
    enviarContainerStartResult(canal, { ref: msg.ref, sucesso: false, erro: explicacao });
  }
}

/** `container_stop` (ADR 0137) — espelho de `tratarContainerStart`. */
export async function tratarContainerStop(
  estado: EstadoDoRunner,
  msg: ContainerStopMessage,
): Promise<void> {
  const canal = estado.canalAtual;
  if (!canal) return;

  try {
    const nome = nomeDeWorkspaceValidado(msg.workspaceDirName);
    await estado.docker.stop(nome);

    if (estado.canalAtual !== canal) return;
    estado.containerAtivo = null;
    enviarContainerStopResult(canal, { ref: msg.ref, sucesso: true });
  } catch (erro) {
    if (estado.canalAtual !== canal) return;
    const explicacao = mensagemDeErro(erro);
    console.warn(`container_stop ${msg.ref}: recusado — ${explicacao}`);
    enviarContainerStopResult(canal, { ref: msg.ref, sucesso: false, erro: explicacao });
  }
}

/** `container_remove` (ADR 0137) — espelho de `tratarContainerStart`. */
export async function tratarContainerRemove(
  estado: EstadoDoRunner,
  msg: ContainerRemoveMessage,
): Promise<void> {
  const canal = estado.canalAtual;
  if (!canal) return;

  try {
    const nome = nomeDeWorkspaceValidado(msg.workspaceDirName);
    await estado.docker.remove(nome);

    if (estado.canalAtual !== canal) return;
    estado.containerAtivo = null;
    enviarContainerRemoveResult(canal, { ref: msg.ref, sucesso: true });
  } catch (erro) {
    if (estado.canalAtual !== canal) return;
    const explicacao = mensagemDeErro(erro);
    console.warn(`container_remove ${msg.ref}: recusado — ${explicacao}`);
    enviarContainerRemoveResult(canal, { ref: msg.ref, sucesso: false, erro: explicacao });
  }
}

/**
 * `mirror_sync` (ADR 0147 pontos 2/4/8, RN-516) — UMA rodada do espelho, num
 * momento NOMEADO pelo engine. Nunca um watcher deste lado: watcher é
 * trabalho ilimitado disparado por qualquer coisa, inclusive pelas escritas
 * do próprio espelho, que é laço.
 *
 * A PRIMEIRA coisa é conferir o destino contra o que foi concedido no join
 * desta conexão. O runner não obedece um destino que o servidor mandou e a
 * concessão não cobre — é isso que impede o artefato de um projeto de
 * aterrissar na pasta de outro, e é por isso que o destino viaja na concessão
 * e não em configuração local.
 *
 * Recusa e falha viram LOG **e reporte**, nunca exceção que derruba o runner e
 * nunca silêncio. O desfecho REAL da rodada volta pelo canal em
 * `mirror_sync_result` (ADR 0147 ponto 7, RN-517) — DEPOIS de a cópia
 * terminar, nunca um "ok" otimista antes —, com a contagem que
 * `sincronizarEspelho` devolveu (nunca recontada aqui) ou com o erro nomeado.
 *
 * As TRÊS saídas reportam, e é isso que faz a tela conseguir distinguir os
 * três estados da RN-088: a recusa por destino não concedido e a falha da
 * cópia são `sucesso: false` com mensagens DIFERENTES, e o sucesso é
 * `sucesso: true` mesmo quando copiou zero arquivo — "sincronizou e não havia
 * nada a copiar" é um estado, não um vazio.
 *
 * Reportar é best-effort de verdade: sem canal (a conexão caiu entre o pedido
 * e o fim da cópia) não há a quem contar, e a rodada que já aconteceu não é
 * desfeita por isso.
 */
export async function tratarMirrorSync(
  estado: EstadoDoRunner,
  msg: MirrorSyncMessage,
): Promise<void> {
  const concedido = estado.destinoDoEspelho;

  if (!concedido || !mesmoCaminho(concedido, msg.destino)) {
    const explicacao =
      `o destino ${JSON.stringify(msg.destino)} não foi concedido nesta ` +
      `conexão (concedido: ${concedido ? JSON.stringify(concedido) : 'nenhum'}). ` +
      `Se o destino do projeto mudou, reconecte o brabo-runner: a concessão é do join.`;
    console.warn(`mirror_sync ${msg.ref}: RECUSADO — ${explicacao}`);
    // `destino` fica de FORA: reportar o destino que veio na mensagem faria a
    // api congelar, como "onde a rodada escreveu", uma pasta que este runner
    // recusou justamente por não ter permissão de escrever nela.
    reportarEspelho(estado, { ref: msg.ref, sucesso: false, erro: explicacao });
    return;
  }

  try {
    const resultado = await sincronizarEspelho({ workspace: estado.dir, destino: concedido });
    console.log(
      `mirror_sync ${msg.ref} (${msg.momento}): ${resultado.copiados} arquivo(s) ` +
        `copiado(s) para ${resultado.destino} ` +
        `(pulados=${resultado.pulados}, recusados=${resultado.recusados}). ` +
        `Nada foi apagado — o espelho nunca remove.`,
    );
    reportarEspelho(estado, {
      ref: msg.ref,
      sucesso: true,
      // O destino REAL, resolvido por `realpath` depois do `mkdir -p` — não o
      // que veio na mensagem: é ele que a api congela na linha.
      destino: resultado.destino,
      copiados: resultado.copiados,
      pulados: resultado.pulados,
      recusados: resultado.recusados,
    });
  } catch (erro) {
    const explicacao = mensagemDeErro(erro);
    console.warn(`mirror_sync ${msg.ref}: falhou — ${explicacao}`);
    reportarEspelho(estado, {
      ref: msg.ref,
      sucesso: false,
      destino: concedido,
      erro: explicacao,
    });
  }
}

/**
 * Empurra o desfecho, se ainda houver canal. Sem canal não há a quem contar —
 * e uma cópia que já aconteceu não vira falha por a conexão ter caído depois
 * dela (a próxima rodada reporta a próxima verdade).
 */
function reportarEspelho(estado: EstadoDoRunner, msg: MirrorSyncResultMessage): void {
  const canal = estado.canalAtual;
  if (!canal) return;
  enviarMirrorSyncResult(canal, msg);
}

/**
 * `workspace_create` (ADR 0151 ponto 3, RN-532) — o engine pede a pasta de um
 * projeto sob a base LOCAL, mandando só o SEGMENTO relativo; quem tem a raiz é
 * este processo (RN-529).
 *
 * ## A confirmação REUSA `workspace_confirm`, e a ORDEM é o mecanismo
 *
 * Tendo dado certo, o `workspace_confirm` que já existe desde a RN-423 é
 * empurrado ANTES do `workspace_create_result`. Não é estética: os dois chegam
 * ao MESMO processo de canal, em ordem, e aquele handler é síncrono (ele chama
 * a api por HTTP interno e só então volta). Empurrar o confirm primeiro é o que
 * garante que, quando o pedinte destravar do `receive`,
 * `workspace_verified_at` já foi carimbado — sem nenhuma rota nova de gravação,
 * sem o engine escrever tabela, e com o único caminho que carimba continuando
 * a ser um só.
 *
 * ## As duas saídas reportam, sempre
 *
 * Ao contrário de `mirror_sync_result` (fire-and-forget dos dois lados), aqui
 * há alguém BLOQUEADO esperando — o molde de `exec_result`/
 * `container_start_result`. Recusa e falha viram `sucesso: false` com o motivo
 * NOMEADO, nunca exceção que derruba o runner e nunca silêncio: silêncio aqui
 * apareceria do outro lado como timeout, escondendo a causa.
 */
export async function tratarWorkspaceCreate(
  estado: EstadoDoRunner,
  msg: WorkspaceCreateMessage,
): Promise<void> {
  const canal = estado.canalAtual;
  if (!canal) return;

  try {
    const resultado = await criarPastaDoProjeto({
      base: estado.base,
      segmento: msg.segmento,
      repoUrl: msg.repoUrl,
      env: msg.env,
    });

    if (estado.canalAtual !== canal) return; // conexão caiu enquanto o git rodava

    // `msg.env` NUNCA aparece aqui, pelo mesmo motivo do `exec` (ADR 0145).
    console.log(
      `workspace_create ${msg.ref}: ${resultado.caminho} (${resultado.modo}) ` +
        `para o projeto ${msg.projectId}`,
    );

    enviarWorkspaceConfirm(canal, { path: resultado.caminho });
    enviarWorkspaceCreateResult(canal, {
      ref: msg.ref,
      sucesso: true,
      caminho: resultado.caminho,
    });
  } catch (erro) {
    if (estado.canalAtual !== canal) return;
    const explicacao = mensagemDeErro(erro);
    console.warn(`workspace_create ${msg.ref}: recusado — ${explicacao}`);
    enviarWorkspaceCreateResult(canal, {
      ref: msg.ref,
      sucesso: false,
      // O motivo NOMEADO é o que o engine DECIDE em cima; o texto é o que um
      // humano lê. Erro que não é do vocabulário deste módulo vira
      // `desconhecido` em vez de se disfarçar de um dos cinco.
      motivo: erro instanceof CriacaoDePastaRecusadaError ? erro.motivo : 'desconhecido',
      erro: explicacao,
    });
  }
}

/**
 * Uma "rodada" de conexão: pede um ticket FRESCO, entra no canal, e só volta
 * quando a conexão cai (ou lança se o join for recusado/não puder
 * conectar). A `credencial` é resolvida uma vez só, em `lerArgumentos` — mas
 * o BEARER que ela produz não é necessariamente reaproveitado entre
 * reconexões: para `tipo: 'token'` (PAT, não expira por uso) é o mesmo
 * valor sempre; para `tipo: 'chave-de-dispositivo'`,
 * `obterTicketDoRunnerComCredencial` assina um JWT NOVO a cada chamada
 * (TTL de 30s — reaproveitar entre reconexões distantes no tempo mandaria
 * um JWT já expirado). O `while` de `main()` decide o que fazer com o
 * retorno/erro — este helper não decide política de retry.
 */
async function conectarERodar(
  apiUrl: string,
  projectId: string,
  credencial: CredencialDeAutenticacao,
  estado: EstadoDoRunner,
  deveParar: () => boolean,
): Promise<void> {
  const ticket = await obterTicketDoRunnerComCredencial(apiUrl, projectId, credencial);

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
      onContainerStart: (msg) => void tratarContainerStart(estado, msg),
      onContainerStop: (msg) => void tratarContainerStop(estado, msg),
      onContainerRemove: (msg) => void tratarContainerRemove(estado, msg),
      onMirrorSync: (msg) => void tratarMirrorSync(estado, msg),
      onWorkspaceCreate: (msg) => void tratarWorkspaceCreate(estado, msg),
      onDisconnected: () => resolverQueda(),
    },
    // ADR 0151 ponto 4 (RN-532): `workspace` só é declarada quando ESTA
    // execução tem base consentida — declarar o que não se pode fazer é
    // exatamente o defeito que a negociação existe para impedir (RN-514).
    capacidades: capacidadesDoRunner(estado.base),
  });

  estado.canalAtual = conexao.channel;
  // ADR 0147 ponto 4 (RN-516): o destino do espelho é o que o SERVIDOR
  // concedeu neste join, e vale só enquanto esta conexão viver.
  estado.destinoDoEspelho = conexao.espelho?.destino ?? null;
  console.log(`conectado ao projeto ${projectId} — aguardando comandos aprovados...`);
  if (estado.destinoDoEspelho) {
    console.log(`espelho concedido: o trabalho será copiado para ${estado.destinoDoEspelho}`);
  }

  // RN-423 (ADR 0104): confirma o `--dir` desta execução pro engine/api —
  // é este runner quem tem autoridade sobre o disco de verdade. Uma vez
  // por conexão (não por comando), logo que o canal está pronto.
  enviarWorkspaceConfirm(conexao.channel, { path: estado.dir });

  await queda;
  estado.canalAtual = null;
  // A concessão morre com a conexão, junto com o canal — ver `EstadoDoRunner`.
  estado.destinoDoEspelho = null;
  if (!deveParar()) {
    console.warn('conexão com o engine caiu — pedindo ticket novo e reconectando...');
  }
}

/**
 * Flag INTERNA, não documentada em `uso()` — existe só pra
 * `scripts/smoke-bin.mjs` (ADR 0112) provar que o `.node` nativo embutido
 * no binário standalone carrega e que `GerenciadorDePty` spawna, ESCREVE
 * e LÊ de um PTY de verdade, sem precisar de rede (engine/api reais) nem
 * de `--project`/`--dir`/`--token`. Nunca chega a
 * `lerArgumentos`/`conectarERodar`.
 *
 * Usa `/bin/cat` como "shell" (via `SHELL`, a única forma que
 * `GerenciadorDePty`/`shellPadrao()` expõe pra escolher o binário — sem
 * argumento próprio pra isso, de propósito: produção sempre abre o shell
 * REAL do usuário), não `/bin/bash` — achado empírico durante a
 * investigação deste ADR: abrir um shell interativo de verdade (bash) num
 * PTY e esperar o PROMPT redesenhar depois de `echo` é lento e ficou
 * flaky sob o runtime do Bun neste sandbox (a saída do prompt nunca
 * chegava dentro do timeout, embora funcionasse sob Node puro). `cat` é
 * determinístico — devolve exatamente o que recebe, sem prompt, sem rc
 * file — e ainda prova o caminho de verdade: `abrir()` spawna um processo
 * REAL via o `.node` nativo, `escrever()` escreve no seu stdin pelo PTY, e
 * o `onData` de volta prova que o processo leu e respondeu. O eco do
 * PRÓPRIO pty (nível kernel, antes de qualquer processo ler) soma UMA
 * ocorrência do marcador; o `cat` ecoando de volta o que leu soma a
 * SEGUNDA — só a segunda prova que um processo de verdade está do outro
 * lado.
 */
async function rodarAutoTestePty(): Promise<void> {
  const nodePty = await carregarNodePty();
  console.log('node-pty carregado com sucesso');

  const shellOriginal = process.env.SHELL;
  process.env.SHELL = '/bin/cat';
  try {
    await new Promise<void>((resolvePromise, rejeitar) => {
      let saida = '';
      let concluido = false;
      const gerenciador = new GerenciadorDePty(
        process.cwd(),
        (_sessionRef, dataBase64) => {
          if (concluido) return;
          saida += Buffer.from(dataBase64, 'base64').toString('utf8');
          const ocorrencias = saida.split('SELF_TEST_PTY_MARKER').length - 1;
          if (ocorrencias >= 2) {
            concluido = true;
            gerenciador.fechar('self-test');
            console.log(`SELF_TEST_PTY_OK: ${JSON.stringify(saida)}`);
            resolvePromise();
          }
        },
        () => {},
        nodePty,
      );
      const resultado = gerenciador.abrir('self-test', 80, 24);
      if (!resultado.ok) {
        rejeitar(new Error(`self-test-pty: abrir() falhou: ${resultado.message}`));
        return;
      }
      gerenciador.escrever(
        'self-test',
        Buffer.from('SELF_TEST_PTY_MARKER\n').toString('base64'),
      );
      setTimeout(
        () =>
          rejeitar(
            new Error(`self-test-pty: timeout esperando o marcador. saida=${JSON.stringify(saida)}`),
          ),
        10_000,
      );
    });
  } finally {
    process.env.SHELL = shellOriginal;
  }
}

/**
 * Segunda flag INTERNA, mesma família de `--self-test-pty` e pelo mesmo motivo
 * estrutural: prova, NO ARTEFATO, o que nenhum teste de unidade prova.
 *
 * Foi ela que respondeu a pergunta do ADR 0128 — `dockerode` sobrevive ao
 * empacotamento? Não sobrevive: com ele no grafo, o `bun build --compile`
 * reprovava resolvendo um `.node` da árvore `ssh2` que `docker-modem` arrasta
 * (o erro está colado por inteiro no docblock de `docker-cli.ts`). E a
 * pergunta só se responde EXECUTANDO: bundler apaga import cujo resultado
 * ninguém usa, e o Bun chega a trocar por um stub que só lança AO RODAR um
 * módulo que não conseguiu resolver (achado do ADR 0112, com `node-pty`). Por
 * isso este auto-teste INSTANCIA a porta e FALA com o daemon.
 *
 * Fica valendo depois da troca para `execFile('docker', …)`, com a mesma
 * pergunta e um alvo a mais: a porta chega inteira no `dist` e no binário, e
 * Docker fora do ar vira erro NOMEADO em vez de stack trace cru.
 *
 * TRÊS desfechos, e dois deles são sucesso — porque a afirmação é sobre o
 * ARTEFATO, não sobre esta máquina. Daemon respondeu; daemon/CLI ausentes (as
 * duas recusas nomeadas, e a máquina de CI legitimamente não tem Docker); e
 * qualquer outra falha, que é a única que reprova. Exigir daemon faria este
 * teste parar de rodar exatamente onde ele mais precisa rodar.
 */
async function rodarAutoTesteDocker(): Promise<void> {
  const docker = new DockerViaCli();
  console.log('porta de docker carregada com sucesso');
  try {
    await docker.ping();
    console.log('SELF_TEST_DOCKER_OK: daemon respondeu ao ping');
  } catch (erro) {
    if (erro instanceof DockerIndisponivelError) {
      console.log(`SELF_TEST_DOCKER_OK: daemon não atendeu (${erro.causa})`);
      return;
    }
    if (erro instanceof DockerCliAusenteError) {
      console.log('SELF_TEST_DOCKER_OK: não há `docker` no PATH desta máquina');
      return;
    }
    throw erro;
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--self-test-pty')) {
    await rodarAutoTestePty();
    return;
  }

  if (process.argv.includes('--self-test-docker')) {
    await rodarAutoTesteDocker();
    return;
  }

  // ANTES de `lerArgumentos` de propósito (ADR 0147 ponto 5, RN-518): `service`
  // não conecta a nada, e o subcomando que mais importa (`status`) precisa
  // funcionar numa pasta cuja configuração está quebrada — que é justamente
  // quando alguém pergunta.
  if (process.argv[2] === 'service') {
    const resposta = rodarSubcomandoDeServico(process.argv);
    const escrever = resposta.fluxo === 'erro' ? console.error : console.log;
    for (const linha of resposta.linhas) escrever(linha);
    process.exit(resposta.codigo);
  }

  const { projectId, dir, apiUrl, credencial, base } = lerArgumentos(process.argv);

  const autenticacaoDescricao =
    credencial.tipo === 'token'
      ? 'token de acesso'
      : `chave de dispositivo (${credencial.deviceKeyId})`;
  console.log(
    `brabo-runner — projeto ${projectId}, raiz ${dir}, api ${apiUrl}, ` +
      `autenticação: ${autenticacaoDescricao}`,
  );
  // Dito SEMPRE, nos dois estados: "sem base" é o caso normal, e omiti-lo
  // deixaria alguém procurando por que a pasta do projeto novo não apareceu.
  console.log(base ? `base de projetos: ${base}` : 'base de projetos: nenhuma configurada');

  // Resolvido UMA vez, antes de montar o estado — normal `import('node-pty')`
  // sob `node dist/index.cjs`/`bun run src/index.ts`; extraído do binário
  // compilado (ADR 0112) só quando `native-pty-loader.ts` detecta que está
  // rodando dentro de um `bun build --compile`.
  const nodePty = await carregarNodePty();
  console.log('node-pty carregado com sucesso');

  const estado: EstadoDoRunner = {
    canalAtual: null,
    dir,
    docker: new DockerViaCli(),
    containerAtivo: null,
    destinoDoEspelho: null,
    base,
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
      nodePty,
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
      await conectarERodar(apiUrl, projectId, credencial, estado, deveParar);
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

// Só roda `main()` quando executado diretamente como CLI — nunca em `import`
// (ex.: se algum teste um dia importar deste arquivo). NÃO compara por nome
// de arquivo (`.endsWith('index.ts')`) — isso quebrava exatamente no caso que
// a publicação via npm existe para habilitar: `npm install -g` cria um
// symlink em `node_modules/.bin/brabo-runner` apontando pro `dist/index.cjs`
// real, e `process.argv[1]` NUNCA é resolvido por realpath pelo Node — só
// `import.meta.url` (e o shim de `import.meta.url` que o tsup gera pro
// build cjs, baseado em `__filename`) é. Sem o `realpathSync` aqui, a
// comparação dava `false` sempre que o CLI rodava pelo `bin` instalado, e
// `main()` nunca era chamado. No Windows o shim `.cmd`/`.ps1` do npm já
// invoca `node <caminho real>` sem symlink — `realpathSync` vira no-op ali.
//
// ADR 0112 — o binário `bun build --compile` quebra essa checagem de um
// jeito NOVO, e pior: `process.argv[1]` dentro dele é `/$bunfs/root/<nome>`
// — um caminho VIRTUAL, dentro do bundle, que `realpathSync` não alcança
// (`lstat` real num caminho que não existe no disco real). Testado
// empiricamente antes de corrigir: sem tratar este caso, `realpathSync`
// LANÇA `ENOENT` fora de qualquer `try/catch`, e o processo morre antes de
// `main()` ser sequer tentado — silencioso o bastante para passar
// despercebido num binário que "compila sem erro". A saída: detectar o
// binário compilado PRIMEIRO (`import.meta.url` de todo módulo embutido no
// bundle começa com `file:///$bunfs/`, provado empiricamente — nunca
// acontece sob `node`/`bun run` fora de um `--compile`) e, nesse caso, rodar
// `main()` incondicionalmente — não há ambiguidade "importado por teste vs.
// executado direto" pra um binário standalone: o próprio entrypoint É o CLI.
const invocadoComoBinarioCompilado = import.meta.url.includes('/$bunfs/');
if (
  invocadoComoBinarioCompilado ||
  (process.argv[1] &&
    import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
) {
  main().catch((erro) => {
    console.error(`falha fatal: ${mensagemDeErro(erro)}`);
    process.exit(1);
  });
}
