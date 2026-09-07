/**
 * `brabo-runner service install | uninstall | status` — o agente local vira
 * um serviço DE USUÁRIO (ADR 0147 ponto 5, RN-518).
 *
 * ## Nível de usuário, SEMPRE — nunca serviço de sistema, nunca root
 *
 * `systemd --user` no Linux, `LaunchAgent` no macOS. Isso não é preferência de
 * empacotamento: o runner roda com os privilégios do usuário **por desenho**, e
 * o docblock de `guard.ts:9-31` declara isso como a premissa em que as três
 * fronteiras reais (autenticação, aprovação, consentimento) se apoiam. Um
 * serviço de sistema rodando como root quebraria o invariante inteiro — a
 * guarda de `cwd` viraria a única coisa entre um comando aprovado e o disco da
 * máquina, e ela é best-effort por escrito.
 *
 * Por isso `install` **RECUSA** quando o processo é root (uid 0), com mensagem
 * própria, em vez de instalar. É recusa, não aviso: instalar e avisar deixaria
 * a instalação errada de pé, e a mensagem seria lida uma vez só.
 *
 * ## Windows fica FORA DE ESCOPO, declarado
 *
 * A matriz de build já produz o binário para Windows (ADR 0112), mas serviço de
 * usuário ali é um TERCEIRO mecanismo (Serviços do SO com conta de usuário, ou
 * Agendador de Tarefas no logon) — não uma variação dos dois que este módulo
 * conhece. Os três subcomandos respondem com recusa NOMEANDO a plataforma e o
 * caminho que continua funcionando (rodar em primeiro plano). Nunca falha muda,
 * e nunca um "instalado" que não instalou nada. Qualquer outra plataforma
 * (freebsd, aix…) cai na mesma recusa, nomeada do mesmo jeito.
 *
 * ## Uma unit POR PROJETO, e o nome sai do `projectId`
 *
 * O runner é por projeto **e** por pasta, mas a unit é nomeada só pelo projeto
 * — `brabo-runner-<projectId>.service` / `dev.brabo.runner.<projectId>` —
 * porque o servidor já impõe **um runner por projeto**: um segundo `join` no
 * mesmo `terminal:<projectId>` é recusado ("outro runner já conectado neste
 * projeto"). Nomear pela pasta permitiria instalar duas units que nunca podem
 * estar de pé ao mesmo tempo, e a segunda apareceria como falha de conexão em
 * vez de erro de instalação. Instalar de novo, de outra pasta, SOBRESCREVE — é
 * a mesma unidade de instalação, apontando para outro lugar.
 *
 * `uninstall` e `status` alcançam exatamente a mesma unit porque derivam o nome
 * do MESMO `projectId`, resolvido pelas mesmas duas fontes na mesma ordem
 * (`--project`, senão `brabo-runner.config.json` da pasta corrente).
 *
 * ## A PASTA a limpar sai do arquivo da unit, não do `cwd`
 *
 * `uninstall` remove três coisas (o ADR é explícito): o arquivo da unit, o
 * `brabo-runner.config.json` e o `brabo-runner-device-key.jwk.json`. Os dois
 * últimos moram na pasta do runner — e a pasta que interessa é a que foi
 * INSTALADA, não a de onde a pessoa por acaso digitou `uninstall`. Por isso o
 * `WorkingDirectory` é lido de volta do próprio arquivo da unit: ele é o
 * registro do que foi instalado. Sem arquivo de unit não há registro, e aí a
 * remoção dos dois arquivos só acontece com `--dir` explícito — nunca por
 * chute sobre o `cwd`, que apagaria a chave de outro projeto.
 *
 * ## O que `uninstall` NÃO faz: revogar a chave no servidor
 *
 * Apagar `brabo-runner-device-key.jwk.json` tira a chave DESTE disco. A chave
 * pública correspondente continua em `runner_device_keys` do lado da api, e
 * revogá-la é `DELETE /projects/:projectId/runner-device-keys/:deviceKeyId` —
 * outra frente da mesma sessão (ADR 0147 ponto 6). A mensagem de `uninstall`
 * DIZ isso: um "removido" que deixasse a pessoa achar que revogou seria pior
 * que não remover nada.
 *
 * ## As DUAS plataformas moram no mesmo arquivo, de propósito
 *
 * `systemd` e `launchd` respondem às MESMAS cinco perguntas (onde mora o
 * arquivo, o que ele contém, como se ativa, como se desativa, como se pergunta
 * o estado) — `PlataformaDeServico` é essa lista. Separar em dois arquivos
 * esconderia justamente a simetria que impede as duas metades de divergirem;
 * o que é específico de cada uma está no objeto dela, e nada mais.
 *
 * ## A fronteira é INJETADA (`SistemaDeServico`)
 *
 * Nenhuma função deste módulo chama `node:fs` ou `node:child_process`
 * diretamente: disco e execução de comando entram por `SistemaDeServico`. O
 * adaptador real mora ao lado, em `servico-sistema.ts`, justamente para que
 * essa garantia continue verdadeira e verificável — a mesma disciplina que
 * separou `device-key.ts` de `auth.ts`. É o que permite o teste provar as
 * quatro respostas de `status` e os desfechos de `install`/`uninstall` sem
 * tocar o `systemd` da máquina de quem roda a suíte — mesmo raciocínio do mock
 * mínimo de `channel.spec.ts`/`index-handlers.spec.ts`.
 */

import { join } from 'node:path';
import { NOME_ARQUIVO_CHAVE, NOME_ARQUIVO_CONFIG } from './device-key.ts';

/** Os três subcomandos de `brabo-runner service`. */
export type Subcomando = 'install' | 'uninstall' | 'status';

export const SUBCOMANDOS: readonly Subcomando[] = ['install', 'uninstall', 'status'];

/**
 * Execução de um comando externo (`systemctl`, `launchctl`). Os DOIS motivos de
 * fracasso são separados na fonte: `nao-consegui` é "não deu para PERGUNTAR"
 * (binário ausente do PATH, `spawn` falhou) e `executou` com código != 0 é "o
 * gerenciador respondeu, e a resposta foi não". Colapsá-los faria `status`
 * dizer "parado" para uma máquina onde nem existe `systemctl` (RN-088).
 */
export type ResultadoDeComando =
  | { estado: 'executou'; codigo: number; saida: string }
  | { estado: 'nao-consegui'; motivo: string };

/** A fronteira injetada: tudo que este módulo faz FORA do próprio processo. */
export interface SistemaDeServico {
  /** Conteúdo do arquivo, ou `null` quando ele não existe / não dá para ler. */
  lerArquivo(caminho: string): string | null;
  /** Cria a pasta e os pais que faltarem (`mkdir -p`). */
  criarPasta(caminho: string): void;
  escreverArquivo(caminho: string, conteudo: string): void;
  /** `true` quando o arquivo EXISTIA e foi apagado; `false` quando não existia. */
  apagarArquivo(caminho: string): boolean;
  existeArquivo(caminho: string): boolean;
  rodar(comando: string, args: string[]): ResultadoDeComando;
}

/** O que este módulo precisa saber do mundo — tudo injetável, nada global. */
export interface ContextoDoServico {
  /** `process.argv` inteiro (o parser lê a partir do índice 2). */
  argv: string[];
  /** A pasta de onde o comando roda — `INIT_CWD ?? process.cwd()`, como no CLI. */
  cwd: string;
  plataforma: NodeJS.Platform;
  home: string;
  /**
   * `XDG_CONFIG_HOME`, quando o usuário a define — `null`/vazio é o normal, e
   * aí vale `~/.config`, o default do próprio systemd. Ela ENTRA no contexto
   * porque é onde o `systemd --user` PROCURA a unit: escrever em `~/.config`
   * numa máquina que aponta a variável para outro lugar produziria um arquivo
   * onde o gerenciador nunca olha. Só o Linux a usa.
   */
  xdgConfigHome: string | null;
  /** `process.getuid?.() ?? null` — `null` onde o SO não tem uid. */
  uid: number | null;
  /**
   * O comando que a unit deve executar, já absoluto: `[binárioCompilado]` ou
   * `[node, caminho/do/index.cjs]`. Quem o computa é `index.ts`, que é o único
   * que sabe por qual dos três caminhos de distribuição está rodando.
   */
  comandoDoRunner: string[];
  /**
   * O `PATH` a CONGELAR na unit. `systemd --user` e `launchd` dão ao serviço um
   * PATH mínimo, e o runner shell-outa para `git` (o espelho, RN-516) e para
   * `docker` (ADR 0137) — sem isso os dois falhariam com "não encontrado" num
   * serviço que subiu perfeitamente. O custo é declarado na própria unit: é um
   * retrato do PATH de quem instalou, e muda só reinstalando.
   */
  path: string;
  sistema: SistemaDeServico;
}

/** Para onde a mensagem vai, e com que código o processo sai. */
export interface RespostaDoServico {
  fluxo: 'saida' | 'erro';
  codigo: number;
  linhas: string[];
}

/**
 * Os QUATRO estados de `status`, e eles NÃO colapsam (RN-088):
 * — `nao-instalado`: não há arquivo de unit. Resposta do DISCO, nunca do
 *   gerenciador — é por isso que ela continua certa numa máquina sem
 *   `systemctl`;
 * — `rodando` / `parado`: o gerenciador respondeu;
 * — `nao-consegui-perguntar`: o arquivo está lá e o gerenciador não respondeu.
 *   "Não sei" nunca vira o lado bom, e também não vira o ruim.
 */
export type EstadoDoServico =
  | 'nao-instalado'
  | 'rodando'
  | 'parado'
  | 'nao-consegui-perguntar';

/**
 * Um código de saída POR estado — quatro estados, quatro códigos. Um único
 * `exit(1)` para os três "não está rodando" colapsaria exatamente o que a
 * RN-088 separa, e quem chama `status` de um script não teria como distinguir
 * "não instalei" de "não consegui olhar". 1 e 2 ficam de fora de propósito: já
 * significam, neste CLI, falha genérica e erro de uso.
 */
export const CODIGO_POR_ESTADO: Record<EstadoDoServico, number> = {
  rodando: 0,
  parado: 3,
  'nao-instalado': 4,
  'nao-consegui-perguntar': 5,
};

/** Onde a unit mora e o que fazer com ela — uma resposta por plataforma. */
interface PlataformaDeServico {
  /** Nome humano, para as mensagens. */
  nome: string;
  /** Caminho absoluto do arquivo de unit/plist. */
  caminhoDaUnidade(ctx: ContextoDoServico, projectId: string): string;
  /** O identificador que o gerenciador usa (unit name / label). */
  identificador(projectId: string): string;
  conteudo(ctx: ContextoDoServico, plano: PlanoDeInstalacao): string;
  /** Lê de volta o `WorkingDirectory` gravado — o registro do que foi instalado. */
  pastaGravada(conteudo: string): string | null;
  /** Comandos a rodar DEPOIS de escrever o arquivo, em ordem. */
  ativar(ctx: ContextoDoServico, projectId: string): { comando: string; args: string[] }[];
  /** Comandos a rodar ANTES de apagar o arquivo, em ordem (best-effort). */
  desativar(ctx: ContextoDoServico, projectId: string): { comando: string; args: string[] }[];
  /** Comandos a rodar DEPOIS de apagar o arquivo (best-effort). */
  depoisDeRemover(ctx: ContextoDoServico, projectId: string): {
    comando: string;
    args: string[];
  }[];
  /** Pergunta o estado ao gerenciador — só chamada com o arquivo já confirmado. */
  perguntarEstado(
    ctx: ContextoDoServico,
    projectId: string,
  ): { estado: Exclude<EstadoDoServico, 'nao-instalado'>; detalhe: string };
}

interface PlanoDeInstalacao {
  projectId: string;
  dir: string;
  apiUrl: string;
}

// ---------------------------------------------------------------- validação

/**
 * O `projectId` vira NOME DE ARQUIVO e ARGUMENTO de comando. Ele vem de duas
 * fontes que não são o servidor (a flag `--project`, digitada, e o
 * `brabo-runner.config.json` da pasta), então a checagem é aqui e não em quem
 * chama: um `--project ../../..` escreveria arquivo fora do diretório de units.
 * UUID — o formato real de todo `projectId` do produto — passa inteiro.
 */
const PROJECT_ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function projectIdValidoParaServico(projectId: string): boolean {
  return PROJECT_ID_VALIDO.test(projectId);
}

/**
 * O caminho entra numa linha `WorkingDirectory="…"` (systemd) e num
 * `<string>` de plist. Aspa dupla e quebra de linha quebrariam o formato dos
 * dois — e um caminho com quebra de linha num arquivo de unit é injeção de
 * diretiva, não caso de borda. Recusa NOMEADA, nunca escape criativo.
 */
function caminhoSeguroParaUnidade(caminho: string): boolean {
  return !caminho.includes('"') && !caminho.includes('\n') && !caminho.includes('\r');
}

// ------------------------------------------------------------------ systemd

const SYSTEMD: PlataformaDeServico = {
  nome: 'systemd --user',

  caminhoDaUnidade(ctx, projectId) {
    // A MESMA precedência do systemd: `$XDG_CONFIG_HOME/systemd/user` quando a
    // variável está posta, `~/.config/systemd/user` quando não. Escolher só o
    // segundo faria a unit nascer onde o gerenciador não olha, e a falha
    // apareceria como "unit file does not exist" no `enable` — visível, mas
    // pelo motivo errado.
    const base =
      ctx.xdgConfigHome && ctx.xdgConfigHome.length > 0
        ? ctx.xdgConfigHome
        : join(ctx.home, '.config');
    return join(base, 'systemd', 'user', SYSTEMD.identificador(projectId));
  },

  identificador(projectId) {
    return `brabo-runner-${projectId}.service`;
  },

  conteudo(ctx, plano) {
    const exec = [...ctx.comandoDoRunner, '--project', plano.projectId, '--dir', plano.dir, '--api-url', plano.apiUrl]
      .map((parte) => `"${parte}"`)
      .join(' ');

    return [
      '# Gerado por `brabo-runner service install` (ADR 0147 ponto 5, RN-518).',
      '# NÃO edite à mão: `service install` sobrescreve este arquivo inteiro.',
      '#',
      '# Serviço de USUÁRIO por desenho — nunca `systemctl` de sistema, nunca root.',
      '# O runner roda com os privilégios do usuário, e é essa premissa que sustenta',
      '# as três fronteiras reais do produto (ver apps/runner/src/guard.ts).',
      '',
      '[Unit]',
      `Description=brabo-runner — agente local do projeto ${plano.projectId}`,
      'Documentation=https://github.com/daneiel/brabo/tree/main/apps/runner#readme',
      'After=network-online.target',
      '',
      '[Service]',
      'Type=simple',
      `WorkingDirectory="${plano.dir}"`,
      `ExecStart=${exec}`,
      '',
      '# `on-abnormal` e NUNCA `on-failure`: o runner sai com 1 quando o join foi',
      '# RECUSADO (ticket inválido, outro runner no projeto, capacidade que falta —',
      '# RN-514) ou quando esgotou o próprio teto de tentativas, e as duas coisas',
      '# são "pare e chame um humano". `on-failure` reiniciaria uma recusa fatal em',
      '# laço, que é exatamente o que o CLI recusa fazer sozinho. Sinal/OOM/watchdog',
      '# — o que `on-abnormal` cobre — é a única falha que reiniciar conserta.',
      'Restart=on-abnormal',
      'RestartSec=5',
      '',
      '# PATH CONGELADO no momento da instalação: `systemd --user` dá ao serviço um',
      '# PATH mínimo, e o runner chama `git` (o espelho, RN-516) e `docker`',
      '# (ADR 0137). Custo declarado: isto é um retrato, e muda só reinstalando.',
      `Environment=PATH=${ctx.path}`,
      '',
      '[Install]',
      '# `default.target` é o alvo da SESSÃO do usuário. Nunca `multi-user.target`,',
      '# que é do gerenciador de sistema e não existe neste escopo.',
      'WantedBy=default.target',
      '',
    ].join('\n');
  },

  pastaGravada(conteudo) {
    const casou = /^WorkingDirectory="(.*)"$/m.exec(conteudo);
    return casou?.[1] ?? null;
  },

  ativar(ctx, projectId) {
    const unidade = SYSTEMD.identificador(projectId);
    return [
      { comando: 'systemctl', args: ['--user', 'daemon-reload'] },
      { comando: 'systemctl', args: ['--user', 'enable', '--now', unidade] },
    ];
  },

  desativar(ctx, projectId) {
    return [
      {
        comando: 'systemctl',
        args: ['--user', 'disable', '--now', SYSTEMD.identificador(projectId)],
      },
    ];
  },

  depoisDeRemover() {
    return [{ comando: 'systemctl', args: ['--user', 'daemon-reload'] }];
  },

  perguntarEstado(ctx, projectId) {
    const resultado = ctx.sistema.rodar('systemctl', [
      '--user',
      'is-active',
      SYSTEMD.identificador(projectId),
    ]);
    if (resultado.estado === 'nao-consegui') {
      return { estado: 'nao-consegui-perguntar', detalhe: resultado.motivo };
    }
    // `is-active` sai com código != 0 para todo estado que não seja ativo — a
    // PALAVRA é a resposta, não o código.
    const palavra = resultado.saida.trim().split(/\s+/)[0] ?? '';
    if (palavra === 'active' || palavra === 'activating' || palavra === 'reloading') {
      return { estado: 'rodando', detalhe: palavra };
    }
    if (
      palavra === 'inactive' ||
      palavra === 'deactivating' ||
      palavra === 'failed' ||
      palavra === 'activating-failed'
    ) {
      return { estado: 'parado', detalhe: palavra };
    }
    // Palavra que este código não conhece: `systemctl` respondeu algo, mas não
    // sabemos o quê. Chutar "parado" seria inventar (RN-088).
    return {
      estado: 'nao-consegui-perguntar',
      detalhe: `systemctl respondeu ${JSON.stringify(palavra)}, que este CLI não sabe interpretar`,
    };
  },
};

// ------------------------------------------------------------------ launchd

function escaparXml(valor: string): string {
  return valor
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function desescaparXml(valor: string): string {
  return valor.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

const LAUNCHD: PlataformaDeServico = {
  nome: 'launchd (LaunchAgent)',

  caminhoDaUnidade(ctx, projectId) {
    return join(ctx.home, 'Library', 'LaunchAgents', `${LAUNCHD.identificador(projectId)}.plist`);
  },

  identificador(projectId) {
    return `dev.brabo.runner.${projectId}`;
  },

  conteudo(ctx, plano) {
    const argumentos = [
      ...ctx.comandoDoRunner,
      '--project',
      plano.projectId,
      '--dir',
      plano.dir,
      '--api-url',
      plano.apiUrl,
    ]
      .map((parte) => `      <string>${escaparXml(parte)}</string>`)
      .join('\n');

    const log = join(ctx.home, 'Library', 'Logs', `brabo-runner-${plano.projectId}.log`);

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '  <dict>',
      '    <key>Label</key>',
      `    <string>${escaparXml(LAUNCHD.identificador(plano.projectId))}</string>`,
      '',
      '    <key>ProgramArguments</key>',
      '    <array>',
      argumentos,
      '    </array>',
      '',
      '    <key>WorkingDirectory</key>',
      `    <string>${escaparXml(plano.dir)}</string>`,
      '',
      '    <key>RunAtLoad</key>',
      '    <true/>',
      '',
      // `Crashed` é o equivalente exato de `Restart=on-abnormal` do systemd:
      // reinicia quando o processo MORREU (sinal), nunca quando ele SAIU com
      // código != 0. `SuccessfulExit=false` faria o oposto — relançaria em laço
      // um join recusado, que é fatal por decisão (RN-514).
      '    <key>KeepAlive</key>',
      '    <dict>',
      '      <key>Crashed</key>',
      '      <true/>',
      '    </dict>',
      '',
      // PATH congelado — mesmo motivo do systemd: `launchd` dá um PATH mínimo e
      // o runner chama `git` e `docker`.
      '    <key>EnvironmentVariables</key>',
      '    <dict>',
      '      <key>PATH</key>',
      `      <string>${escaparXml(ctx.path)}</string>`,
      '    </dict>',
      '',
      // `launchd` não tem journal: sem estes dois a saída do runner some.
      // `uninstall` NÃO apaga o log — ele é o registro do usuário sobre o que
      // aconteceu, e apagá-lo não foi pedido.
      '    <key>StandardOutPath</key>',
      `    <string>${escaparXml(log)}</string>`,
      '    <key>StandardErrorPath</key>',
      `    <string>${escaparXml(log)}</string>`,
      '  </dict>',
      '</plist>',
      '',
    ].join('\n');
  },

  pastaGravada(conteudo) {
    const casou = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(conteudo);
    return casou?.[1] === undefined ? null : desescaparXml(casou[1]);
  },

  ativar(ctx, projectId) {
    return [
      {
        comando: 'launchctl',
        args: ['bootstrap', `gui/${ctx.uid ?? 0}`, LAUNCHD.caminhoDaUnidade(ctx, projectId)],
      },
    ];
  },

  desativar(ctx, projectId) {
    return [
      {
        comando: 'launchctl',
        args: ['bootout', `gui/${ctx.uid ?? 0}/${LAUNCHD.identificador(projectId)}`],
      },
    ];
  },

  depoisDeRemover() {
    return [];
  },

  perguntarEstado(ctx, projectId) {
    const resultado = ctx.sistema.rodar('launchctl', ['list', LAUNCHD.identificador(projectId)]);
    if (resultado.estado === 'nao-consegui') {
      return { estado: 'nao-consegui-perguntar', detalhe: resultado.motivo };
    }
    if (resultado.codigo !== 0) {
      // O plist está no disco e o `launchd` não o tem carregado — instalado e
      // parado, que é uma resposta e não uma falha.
      return { estado: 'parado', detalhe: 'launchctl não tem o agente carregado' };
    }
    // Carregado: só tem `PID` quando há processo de pé agora.
    return /"PID"\s*=/.test(resultado.saida)
      ? { estado: 'rodando', detalhe: 'launchctl reporta PID' }
      : { estado: 'parado', detalhe: 'carregado, sem PID' };
  },
};

// ------------------------------------------------------------- despacho

/**
 * A plataforma, ou `null` quando este módulo não a atende. `null` NÃO é falha
 * silenciosa: quem chama transforma em recusa nomeada.
 */
function plataformaDe(plataforma: NodeJS.Platform): PlataformaDeServico | null {
  if (plataforma === 'linux') return SYSTEMD;
  if (plataforma === 'darwin') return LAUNCHD;
  return null;
}

function recusa(linhas: string[], codigo = 2): RespostaDoServico {
  return { fluxo: 'erro', codigo, linhas };
}

function recusaDePlataforma(plataforma: NodeJS.Platform): RespostaDoServico {
  const ehWindows = plataforma === 'win32';
  return recusa([
    `brabo-runner service não atende esta plataforma (${plataforma}).`,
    ehWindows
      ? 'Windows está FORA DE ESCOPO por decisão declarada (ADR 0147 ponto 5): serviço de ' +
        'usuário ali é um terceiro mecanismo (Serviços do SO com conta de usuário, ou ' +
        'Agendador de Tarefas no logon), não uma variação de systemd/launchd.'
      : 'Os dois mecanismos suportados são `systemd --user` (Linux) e LaunchAgent (macOS).',
    'O runner continua funcionando em primeiro plano: rode `brabo-runner` na pasta do ' +
      'projeto e deixe o processo aberto.',
  ]);
}

// ------------------------------------------------------------ argumentos

interface LeituraDeArgumentos {
  valorDe(flag: string): string | undefined;
  informado(flag: string): boolean;
}

function argumentos(argv: string[]): LeituraDeArgumentos {
  const args = argv.slice(2);
  return {
    valorDe(flag) {
      const indice = args.indexOf(flag);
      if (indice < 0) return undefined;
      const valor = args[indice + 1];
      return valor === undefined || valor.startsWith('--') ? undefined : valor;
    },
    informado(flag) {
      return args.includes(flag);
    },
  };
}

export interface ProjetoResolvido {
  projectId: string;
  /** De onde veio — entra na mensagem, porque a fonte errada é o erro comum. */
  fonte: 'flag' | 'config';
}

/**
 * As MESMAS duas fontes, na MESMA ordem do CLI de sempre: `--project` vence, e
 * na ausência dela o `brabo-runner.config.json` resolve. Nenhuma terceira
 * fonte.
 *
 * `pasta` é onde procurar esse config, e ela difere por subcomando de
 * propósito: `install` procura na pasta que vai ser INSTALADA (`--dir`, ou o
 * `cwd` quando ela é omitida — os dois casos idênticos no uso normal, que é
 * rodar `install` de dentro da pasta configurada), enquanto `uninstall`/`status`
 * procuram no `cwd` porque a pasta instalada só se descobre depois, lendo o
 * arquivo da unit. Nenhum dos três resolve caminho aqui: quem resolve é o
 * `resolverDir` de `guard.ts`, injetado.
 */
export function resolverProjeto(
  ctx: ContextoDoServico,
  lerConfig: (pasta: string) => { projectId: string } | null,
  pasta: string = ctx.cwd,
): ProjetoResolvido | null {
  const args = argumentos(ctx.argv);
  if (args.informado('--project')) {
    const valor = args.valorDe('--project');
    return valor ? { projectId: valor, fonte: 'flag' } : null;
  }
  const config = lerConfig(pasta);
  return config ? { projectId: config.projectId, fonte: 'config' } : null;
}

// ---------------------------------------------------------------- install

export interface DependenciasDeInstalacao {
  lerConfig: (cwd: string) => { projectId: string; apiUrl: string } | null;
  /** `lerChaveDeDispositivo` — a credencial que um serviço PODE usar. */
  lerChave: (dir: string) => { deviceKeyId: string } | null;
  /** `resolverDir` de `guard.ts` — a régua ÚNICA de caminho, nunca uma cópia. */
  resolverDir: (bruto: string, cwd: string) => string;
  /** `validarDirDentroDoHomeNoLinux` — lança quando o dir sai do $HOME (RN-434). */
  validarDir: (dir: string, plataforma: NodeJS.Platform, home: string) => void;
}

export function instalar(
  ctx: ContextoDoServico,
  deps: DependenciasDeInstalacao,
): RespostaDoServico {
  const plataforma = plataformaDe(ctx.plataforma);
  if (!plataforma) return recusaDePlataforma(ctx.plataforma);

  // Root ANTES de tudo: nada é escrito, nada é perguntado. Ver o docblock.
  if (ctx.uid === 0) {
    return recusa([
      'brabo-runner service install RECUSA rodar como root.',
      'O serviço é de USUÁRIO por desenho (systemd --user / LaunchAgent) — o runner roda ' +
        'com os privilégios do seu usuário, e é essa premissa que sustenta as fronteiras ' +
        'do produto (ver apps/runner/src/guard.ts). Um serviço de sistema rodando como ' +
        'root as quebraria.',
      'Rode este comando com o SEU usuário, sem sudo/doas.',
    ]);
  }

  // A PASTA primeiro, e só então o projeto: quem manda no `install` é a pasta
  // que vai ser instalada, e é o config DELA que responde por qual projeto ela
  // é. Sem `--dir` os dois são o mesmo lugar — o uso normal, que é rodar
  // `install` de dentro da pasta configurada.
  const args = argumentos(ctx.argv);
  const dirBruto = args.informado('--dir') ? (args.valorDe('--dir') ?? '.') : '.';
  const dir = deps.resolverDir(dirBruto, ctx.cwd);

  // RN-434, a MESMA checagem do caminho de sempre e a mesma função: um serviço
  // apontando para fora do $HOME no Linux é exatamente o que ela recusa, e
  // instalá-lo seria fazer por unit o que a CLI recusa fazer por flag.
  try {
    deps.validarDir(dir, ctx.plataforma, ctx.home);
  } catch (erro) {
    return recusa([erro instanceof Error ? erro.message : String(erro)]);
  }

  const projeto = resolverProjeto(ctx, deps.lerConfig, dir);
  if (!projeto) {
    return recusa([
      'brabo-runner service install precisa saber QUAL projeto instalar.',
      `Informe --project <projectId>, ou rode dentro da pasta que tem ${NOME_ARQUIVO_CONFIG} ` +
        '(a que o botão "Configurar pasta automaticamente" baixou).',
    ]);
  }
  if (!projectIdValidoParaServico(projeto.projectId)) {
    return recusa([
      `projectId recusado: ${JSON.stringify(projeto.projectId)}.`,
      'Ele vira NOME DE ARQUIVO da unit e argumento de comando, então só letras, dígitos, ' +
        '`.`, `-` e `_` (até 64 caracteres) são aceitos.',
      projeto.fonte === 'config'
        ? `O valor veio de ${NOME_ARQUIVO_CONFIG} de ${dir} — regrave a pasta pela tela do projeto.`
        : 'O valor veio de --project.',
    ]);
  }

  if (!caminhoSeguroParaUnidade(dir)) {
    return recusa([
      `A pasta ${JSON.stringify(dir)} não pode ir para um arquivo de unit: ela contém aspa ` +
        'dupla ou quebra de linha, que quebrariam o formato do systemd e do plist.',
      'Escolha uma pasta sem esses caracteres.',
    ]);
  }
  for (const parte of ctx.comandoDoRunner) {
    if (!caminhoSeguroParaUnidade(parte)) {
      return recusa([
        `O caminho do próprio runner (${JSON.stringify(parte)}) contém aspa dupla ou quebra ` +
          'de linha e não pode ir para um arquivo de unit.',
        'Instale o binário num caminho sem esses caracteres.',
      ]);
    }
  }

  // A credencial de um SERVIÇO é a chave de dispositivo da pasta, e só ela.
  // `--token`/`BRABO_ACCOUNT_TOKEN` são deliberadamente ignorados aqui: gravar
  // um token de conta dentro de um arquivo de unit o deixaria em disco, legível
  // por qualquer processo do usuário e sobrevivendo ao shell que o exportou —
  // e o CLI nunca gravou credencial em disco (ver o docblock de auth.ts).
  const chave = deps.lerChave(dir);
  if (!chave) {
    return recusa([
      `Não há ${NOME_ARQUIVO_CHAVE} válido em ${dir}.`,
      'Um serviço autentica pela CHAVE DE DISPOSITIVO daquela pasta, nunca por token: ' +
        '--token/BRABO_ACCOUNT_TOKEN vivem no seu shell, e gravá-los num arquivo de unit ' +
        'os deixaria em disco — coisa que este CLI nunca faz.',
      'Use "Configurar pasta automaticamente" na tela do projeto para gravar a pasta, e ' +
        'rode `brabo-runner service install` de dentro dela.',
    ]);
  }

  const config = deps.lerConfig(dir);
  const apiUrl = args.valorDe('--api-url') ?? config?.apiUrl ?? 'http://localhost:3000';
  if (!caminhoSeguroParaUnidade(apiUrl) || /\s/.test(apiUrl)) {
    return recusa([`--api-url recusada: ${JSON.stringify(apiUrl)} tem espaço, aspa ou quebra de linha.`]);
  }

  const plano: PlanoDeInstalacao = { projectId: projeto.projectId, dir, apiUrl };
  const caminho = plataforma.caminhoDaUnidade(ctx, projeto.projectId);

  ctx.sistema.criarPasta(join(caminho, '..'));
  ctx.sistema.escreverArquivo(caminho, plataforma.conteudo(ctx, plano));

  const pendentes: string[] = [];
  for (const passo of plataforma.ativar(ctx, projeto.projectId)) {
    const resultado = ctx.sistema.rodar(passo.comando, passo.args);
    if (resultado.estado === 'nao-consegui') {
      pendentes.push(`${passo.comando} ${passo.args.join(' ')}  (${resultado.motivo})`);
      break;
    }
    if (resultado.codigo !== 0) {
      pendentes.push(
        `${passo.comando} ${passo.args.join(' ')}  (saiu ${resultado.codigo}: ${resultado.saida.trim()})`,
      );
      break;
    }
  }

  const cabeca = [
    `Unit escrita: ${caminho}`,
    `  projeto: ${projeto.projectId}`,
    `  pasta:   ${dir}`,
    `  api:     ${apiUrl}`,
    `  chave:   ${chave.deviceKeyId}`,
  ];

  if (pendentes.length > 0) {
    // O ARQUIVO ficou. Não o apagamos: ele é o que a pessoa precisa para
    // terminar à mão, e apagá-lo transformaria "não consegui ativar" em "não
    // aconteceu nada", que é falso.
    return {
      fluxo: 'erro',
      codigo: 5,
      linhas: [
        ...cabeca,
        '',
        `O arquivo foi gravado, mas NÃO foi possível ativá-lo pelo ${plataforma.nome}:`,
        ...pendentes.map((linha) => `  ${linha}`),
        '',
        'O arquivo continua no lugar de propósito — rode o comando acima à mão quando o ' +
          'gerenciador estiver disponível, ou `brabo-runner service uninstall` para desfazer.',
      ],
    };
  }

  return {
    fluxo: 'saida',
    codigo: 0,
    linhas: [
      ...cabeca,
      '',
      `Serviço de usuário ativado (${plataforma.nome}): ${plataforma.identificador(projeto.projectId)}`,
      'Ele sobe junto com a sua sessão e roda com o SEU usuário — nunca como root.',
      'Confira com `brabo-runner service status`.',
    ],
  };
}

// -------------------------------------------------------------- uninstall

export interface DependenciasDeRemocao {
  lerConfig: (cwd: string) => { projectId: string } | null;
  resolverDir: (bruto: string, cwd: string) => string;
}

export function desinstalar(
  ctx: ContextoDoServico,
  deps: DependenciasDeRemocao,
): RespostaDoServico {
  const plataforma = plataformaDe(ctx.plataforma);
  if (!plataforma) return recusaDePlataforma(ctx.plataforma);

  const projeto = resolverProjeto(ctx, deps.lerConfig);
  if (!projeto || !projectIdValidoParaServico(projeto.projectId)) {
    return recusa([
      'brabo-runner service uninstall precisa saber QUAL projeto remover.',
      `Informe --project <projectId>, ou rode dentro da pasta que tem ${NOME_ARQUIVO_CONFIG}.`,
    ]);
  }

  const caminho = plataforma.caminhoDaUnidade(ctx, projeto.projectId);
  const conteudo = ctx.sistema.lerArquivo(caminho);

  const args = argumentos(ctx.argv);
  // A pasta a limpar sai do ARQUIVO DA UNIT — o registro do que foi instalado.
  // `--dir` só entra quando não há unit de onde ler; nunca por chute sobre o
  // `cwd`, que apagaria a chave de um projeto que ninguém pediu para remover.
  const pastaDaUnit = conteudo ? plataforma.pastaGravada(conteudo) : null;
  const pastaPorFlag = args.informado('--dir')
    ? deps.resolverDir(args.valorDe('--dir') ?? '.', ctx.cwd)
    : null;
  const pasta = pastaDaUnit ?? pastaPorFlag;

  const linhas: string[] = [];

  if (conteudo === null) {
    linhas.push(`Não há unit instalada para o projeto ${projeto.projectId} (${caminho} não existe).`);
  } else {
    for (const passo of plataforma.desativar(ctx, projeto.projectId)) {
      const resultado = ctx.sistema.rodar(passo.comando, passo.args);
      if (resultado.estado === 'nao-consegui') {
        linhas.push(
          `aviso: não consegui rodar \`${passo.comando} ${passo.args.join(' ')}\` (${resultado.motivo}) — ` +
            'o arquivo é removido assim mesmo.',
        );
      } else if (resultado.codigo !== 0) {
        linhas.push(
          `aviso: \`${passo.comando} ${passo.args.join(' ')}\` saiu ${resultado.codigo} ` +
            `(${resultado.saida.trim()}) — o arquivo é removido assim mesmo.`,
        );
      }
    }
    ctx.sistema.apagarArquivo(caminho);
    linhas.push(`unit removida: ${caminho}`);
    for (const passo of plataforma.depoisDeRemover(ctx, projeto.projectId)) {
      ctx.sistema.rodar(passo.comando, passo.args);
    }
  }

  if (pasta === null) {
    linhas.push(
      `${NOME_ARQUIVO_CONFIG} e ${NOME_ARQUIVO_CHAVE} NÃO foram tocados: sem a unit não há ` +
        'registro de qual pasta foi instalada, e adivinhar pela pasta corrente apagaria a ' +
        'chave de outro projeto. Passe --dir <pasta> para removê-los.',
    );
  } else {
    for (const nome of [NOME_ARQUIVO_CONFIG, NOME_ARQUIVO_CHAVE]) {
      const alvo = join(pasta, nome);
      linhas.push(
        ctx.sistema.apagarArquivo(alvo) ? `removido: ${alvo}` : `já não existia: ${alvo}`,
      );
    }
    linhas.push(
      '',
      'A chave de dispositivo saiu DESTE disco — ela NÃO foi revogada no servidor. A pública ' +
        'correspondente continua registrada no projeto; revogue-a pela tela do projeto se ' +
        'quiser que ela pare de valer para qualquer máquina.',
    );
  }

  return {
    fluxo: 'saida',
    codigo: conteudo === null ? CODIGO_POR_ESTADO['nao-instalado'] : 0,
    linhas,
  };
}

// ----------------------------------------------------------------- status

export interface DependenciasDeStatus {
  lerConfig: (cwd: string) => { projectId: string } | null;
}

export interface RelatorioDeStatus {
  estado: EstadoDoServico;
  caminho: string;
  detalhe: string;
}

/** A pergunta, sem formatação — é o que o teste afere. */
export function consultarStatus(
  ctx: ContextoDoServico,
  projectId: string,
): RelatorioDeStatus | null {
  const plataforma = plataformaDe(ctx.plataforma);
  if (!plataforma) return null;

  const caminho = plataforma.caminhoDaUnidade(ctx, projectId);
  // O DISCO responde "instalado?" — e essa resposta continua certa numa máquina
  // onde o gerenciador não existe. Só depois se pergunta ao gerenciador.
  if (!ctx.sistema.existeArquivo(caminho)) {
    return { estado: 'nao-instalado', caminho, detalhe: 'não há arquivo de unit' };
  }

  const resposta = plataforma.perguntarEstado(ctx, projectId);
  return { estado: resposta.estado, caminho, detalhe: resposta.detalhe };
}

const FRASE_POR_ESTADO: Record<EstadoDoServico, string> = {
  'nao-instalado': 'NÃO INSTALADO — não há serviço de usuário para este projeto nesta máquina.',
  rodando: 'INSTALADO E RODANDO — o agente local está de pé agora.',
  parado: 'INSTALADO E PARADO — a unit existe, e o serviço não está rodando.',
  'nao-consegui-perguntar':
    'INSTALADO, E NÃO CONSEGUI PERGUNTAR se está rodando — a unit existe no disco e o ' +
    'gerenciador de serviços não respondeu. Isto NÃO quer dizer que está parado.',
};

export function status(ctx: ContextoDoServico, deps: DependenciasDeStatus): RespostaDoServico {
  const plataforma = plataformaDe(ctx.plataforma);
  if (!plataforma) return recusaDePlataforma(ctx.plataforma);

  const projeto = resolverProjeto(ctx, deps.lerConfig);
  if (!projeto || !projectIdValidoParaServico(projeto.projectId)) {
    return recusa([
      'brabo-runner service status precisa saber QUAL projeto consultar.',
      `Informe --project <projectId>, ou rode dentro da pasta que tem ${NOME_ARQUIVO_CONFIG}.`,
    ]);
  }

  const relatorio = consultarStatus(ctx, projeto.projectId);
  /* c8 ignore next */
  if (!relatorio) return recusaDePlataforma(ctx.plataforma);

  return {
    fluxo: 'saida',
    codigo: CODIGO_POR_ESTADO[relatorio.estado],
    linhas: [
      `projeto ${projeto.projectId} — ${plataforma.nome}`,
      FRASE_POR_ESTADO[relatorio.estado],
      `  unit:    ${relatorio.caminho}`,
      `  detalhe: ${relatorio.detalhe}`,
      `  código de saída: ${CODIGO_POR_ESTADO[relatorio.estado]} (um por estado — nunca colapsados)`,
    ],
  };
}

// ------------------------------------------------------------- subcomando

export function ehSubcomandoConhecido(valor: string | undefined): valor is Subcomando {
  return valor !== undefined && (SUBCOMANDOS as readonly string[]).includes(valor);
}

export function usoDeServico(): RespostaDoServico {
  return recusa([
    'uso: brabo-runner service <install|uninstall|status> [--project <id>] [--dir <pasta>]',
    '',
    'install   — instala o runner como serviço de USUÁRIO (systemd --user no Linux, ' +
      'LaunchAgent no macOS). Nunca serviço de sistema, nunca root.',
    'uninstall — remove a unit, o brabo-runner.config.json e a chave de dispositivo DESTE ' +
      'disco (a revogação no servidor é outra coisa, feita pela tela do projeto).',
    'status    — diz um de quatro estados, sem colapsar nenhum: não instalado, instalado e ' +
      'rodando, instalado e parado, ou instalado e não consegui perguntar.',
    '',
    'Windows fica fora de escopo por decisão declarada (ADR 0147 ponto 5).',
  ]);
}
