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
 * de pasta local, sem a barreira de `guard.ts` — ver o docblock dele).
 */

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  obterToken,
  obterTicketDoRunnerComCredencial,
  type CredencialDeAutenticacao,
} from './auth.ts';
import {
  conectarCanal,
  enviarExecResult,
  enviarFsHomeDirReply,
  enviarFsListDirReply,
  enviarPtyData,
  enviarPtyError,
  enviarPtyOpened,
  enviarWorkspaceConfirm,
  JoinRecusadoError,
  type ChannelLike,
  type ExecMessage,
  type FsHomeDirMessage,
  type FsListDirMessage,
  type PtyOpenMessage,
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
} from '@brabo/docker-port';
import { executarComando } from './exec.ts';
import { diretorioInicial, listarDiretorio } from './fs-browser.ts';
import {
  CwdForaDaRaizError,
  DirForaDoHomeError,
  DirNaoEUmaPastaError,
  garantirDiretorio,
  NaoConsegiuCriarDiretorioError,
  resolverDir,
  validarCwdDentroDaRaiz,
  validarDirDentroDoHomeNoLinux,
} from './guard.ts';
import { carregarNodePty } from './native-pty-loader.ts';
import { GerenciadorDePty } from './pty.ts';

interface Argumentos {
  projectId: string;
  dir: string;
  apiUrl: string;
  credencial: CredencialDeAutenticacao;
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
    'Autenticação: --token <brb_...>, ou BRABO_ACCOUNT_TOKEN no ambiente. Gere em ' +
      'Configurações do projeto → Tokens de acesso — nunca gravado em disco por este ' +
      'CLI. Sem token, a chave de dispositivo local (modo automático) é usada.',
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

  return { projectId, dir, apiUrl, credencial };
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
      onDisconnected: () => resolverQueda(),
    },
  });

  estado.canalAtual = conexao.channel;
  console.log(`conectado ao projeto ${projectId} — aguardando comandos aprovados...`);

  // RN-423 (ADR 0104): confirma o `--dir` desta execução pro engine/api —
  // é este runner quem tem autoridade sobre o disco de verdade. Uma vez
  // por conexão (não por comando), logo que o canal está pronto.
  enviarWorkspaceConfirm(conexao.channel, { path: estado.dir });

  await queda;
  estado.canalAtual = null;
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

  const { projectId, dir, apiUrl, credencial } = lerArgumentos(process.argv);

  const autenticacaoDescricao =
    credencial.tipo === 'token'
      ? 'token de acesso'
      : `chave de dispositivo (${credencial.deviceKeyId})`;
  console.log(
    `brabo-runner — projeto ${projectId}, raiz ${dir}, api ${apiUrl}, ` +
      `autenticação: ${autenticacaoDescricao}`,
  );

  // Resolvido UMA vez, antes de montar o estado — normal `import('node-pty')`
  // sob `node dist/index.cjs`/`bun run src/index.ts`; extraído do binário
  // compilado (ADR 0112) só quando `native-pty-loader.ts` detecta que está
  // rodando dentro de um `bun build --compile`.
  const nodePty = await carregarNodePty();
  console.log('node-pty carregado com sucesso');

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
