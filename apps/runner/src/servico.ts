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
 * ## E, desde a RN-545, uma unit POR MÁQUINA — a segunda ESPÉCIE
 *
 * O modo de máquina da RN-544 é UM processo que abre N conexões, e ele não tem
 * `projectId` nenhum: a lista de projetos vem de `GET runner/projects` e a
 * pasta de cada um sai da BASE consentida. A unit que o põe de pé é
 * `brabo-runner.service` / `dev.brabo.runner`, sem sufixo — e o nome NÃO pode
 * colidir com o de projeto nenhum, o que é verdade por construção e travado
 * por teste: `PROJECT_ID_VALIDO` exige ao menos um caractere, então
 * `brabo-runner-<id>.service` nunca é `brabo-runner.service` (diferem no 13º
 * caractere, `-` contra `.`), e `dev.brabo.runner.<id>` nunca é
 * `dev.brabo.runner`.
 *
 * As duas espécies **convivem**, e é por isso que `AlvoDaUnidade` é um tipo
 * discriminado e não um `projectId | null`: os seis membros de
 * `PlataformaDeServico` que recebiam `projectId` passam a receber o alvo, e
 * "não há projeto" vira fato de TIPO em vez de checagem de nulo espalhada.
 *
 * ### O discriminador é a flag `--machine`, e NUNCA a ausência de `--project`
 *
 * O ADR 0154 ponto 5 escreveu *"`service install` sem `--project` instala a
 * unit de máquina"*. Isso foi medido aqui e **não** pôde ser implementado ao
 * pé da letra: `resolverProjeto` tem DUAS fontes, e o caminho NORMAL de hoje é
 * rodar `install` sem flag nenhuma de dentro da pasta que o navegador
 * configurou — é o `brabo-runner.config.json` que responde. Tratar "sem
 * `--project`" como "máquina" converteria em silêncio a instalação de quem já
 * usa o produto, que é exatamente o que o ponto 5 do mesmo ADR promete não
 * fazer. Então a espécie nova é **opt-in explícito** (`--machine`), as duas
 * fontes de projeto seguem byte a byte, e `--machine` junto de `--project` é
 * recusa nomeada em vez de precedência inventada.
 *
 * ### `install` RECUSA quando a outra espécie já está instalada
 *
 * O agente de máquina atende TODO projeto em modo `runner` do dono da chave.
 * Somar a ele uma unit por projeto (ou o contrário) põe dois processos
 * disputando o mesmo `terminal:<projectId>`, e o servidor nega um dos dois —
 * provavelmente o que a pessoa acabou de instalar, que é a pior ordem possível
 * para descobrir o problema. É recusa pelo MESMO critério da recusa de root,
 * algumas linhas acima: instalar e avisar deixaria a instalação errada de pé, e
 * a mensagem seria lida uma vez só. Nada é removido pela recusa — a unit que
 * já existe continua exatamente como estava, e a mensagem nomeia o `uninstall`
 * de cada uma. Não há `--force`: uma flag que derruba uma guarda cujo sintoma é
 * silencioso devolve o sintoma silencioso.
 *
 * ### `status` responde sobre a espécie pedida, e DIZ que a outra existe
 *
 * Os quatro estados e os quatro códigos de saída (RN-088) não viram oito, e não
 * são somados: o código continua sendo o da unit PERGUNTADA. A coexistência
 * aparece em TEXTO, e é resposta do DISCO — as units da outra espécie são
 * listadas pelo nome, sem perguntar o estado de cada uma ao gerenciador, e a
 * saída DIZ que não perguntou (a mesma honestidade de `naoVerificado` na página
 * de containers). Sem `--machine` e sem projeto resolvível, o principal é a
 * unit de MÁQUINA — é a única cujo nome não precisa de argumento —, e a saída
 * nomeia `--project` para quem queria a outra.
 *
 * `uninstall` NÃO herda esse default, e a assimetria é deliberada: ler a
 * espécie errada custa uma linha errada, remover a espécie errada custa um
 * serviço e uma chave de dispositivo. Sem espécie nomeada ele RECUSA, listando
 * o que existe no disco e o comando exato de cada um.
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
  /**
   * Nomes dos arquivos da pasta, ou `[]` quando ela não existe / não dá para
   * ler. Existe por causa da coexistência das duas espécies (RN-545): é como
   * `status` acha as units de PROJETO sem que ninguém lhe diga quais são, e é
   * como `install` descobre que há a outra espécie antes de sobrepor-se a ela.
   * Lista vazia e pasta ilegível colapsam de propósito — os dois querem dizer
   * "não achei unit nenhuma aqui", e este módulo não age sobre a diferença.
   */
  listarPasta(caminho: string): string[];
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
  /**
   * `BRABO_API_URL` do ambiente de quem instala, ou `null`. Ela entra no
   * contexto por causa da unit de MÁQUINA (RN-545), e só ela a usa: no plano
   * por PROJETO há um `brabo-runner.config.json` respondendo qual é a api, e a
   * precedência de lá (`--api-url` › config › default) fica byte a byte. No
   * plano de máquina esse arquivo é por projeto e não serve, então sem esta
   * variável a única alternativa a `--api-url` seria o default `localhost` —
   * ou seja, instalar de um shell com `BRABO_API_URL` posta geraria em
   * silêncio uma unit apontando para o lugar errado.
   */
  apiUrlDoAmbiente: string | null;
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

/**
 * De QUAL das duas espécies de unit se está falando (RN-545). Tipo
 * discriminado, e não `projectId: string | null`, porque "o agente de máquina
 * não tem projeto" é um fato, não um valor ausente: com o nulo, cada um dos
 * seis membros de `PlataformaDeServico` teria de decidir sozinho o que fazer
 * com ele, e o compilador não cobraria nenhum.
 */
export type AlvoDaUnidade =
  | { especie: 'projeto'; projectId: string }
  | { especie: 'maquina' };

/** A unit ÚNICA do agente de máquina — sem `projectId`, por desenho. */
export const ALVO_DE_MAQUINA: AlvoDaUnidade = { especie: 'maquina' };

export function alvoDeProjeto(projectId: string): AlvoDaUnidade {
  return { especie: 'projeto', projectId };
}

/** Onde a unit mora e o que fazer com ela — uma resposta por plataforma. */
interface PlataformaDeServico {
  /** Nome humano, para as mensagens. */
  nome: string;
  /** A pasta onde TODAS as units desta plataforma moram — as duas espécies. */
  pastaDasUnidades(ctx: ContextoDoServico): string;
  /** O nome do ARQUIVO dentro dessa pasta (com extensão, onde houver). */
  nomeDoArquivo(alvo: AlvoDaUnidade): string;
  /**
   * O `projectId` que um nome de arquivo da pasta descreve, ou `null` quando
   * ele não é unit de PROJETO desta plataforma — inclusive quando é a unit de
   * MÁQUINA. É o inverso de `nomeDoArquivo`, e é o que trava por teste a
   * ausência de colisão entre as duas espécies.
   */
  projetoDoArquivo(nome: string): string | null;
  /** O identificador que o gerenciador usa (unit name / label). */
  identificador(alvo: AlvoDaUnidade): string;
  conteudo(ctx: ContextoDoServico, plano: PlanoDeInstalacao): string;
  /** Lê de volta o `WorkingDirectory` gravado — o registro do que foi instalado. */
  pastaGravada(conteudo: string): string | null;
  /** Comandos a rodar DEPOIS de escrever o arquivo, em ordem. */
  ativar(ctx: ContextoDoServico, alvo: AlvoDaUnidade): { comando: string; args: string[] }[];
  /** Comandos a rodar ANTES de apagar o arquivo, em ordem (best-effort). */
  desativar(ctx: ContextoDoServico, alvo: AlvoDaUnidade): { comando: string; args: string[] }[];
  /** Comandos a rodar DEPOIS de apagar o arquivo (best-effort). */
  depoisDeRemover(ctx: ContextoDoServico, alvo: AlvoDaUnidade): {
    comando: string;
    args: string[];
  }[];
  /** Pergunta o estado ao gerenciador — só chamada com o arquivo já confirmado. */
  perguntarEstado(
    ctx: ContextoDoServico,
    alvo: AlvoDaUnidade,
  ): { estado: Exclude<EstadoDoServico, 'nao-instalado'>; detalhe: string };
}

/**
 * O que vai para dentro do arquivo. União discriminada pela MESMA razão de
 * `AlvoDaUnidade`: os três campos do plano de projeto (`projectId`, `dir` como
 * raiz DO projeto, `apiUrl` vinda do config daquela pasta) deixam de fazer
 * sentido na máquina — lá não há projeto, `--dir` não existe (cada raiz sai da
 * base) e a api não pode vir de um arquivo que é por projeto.
 *
 * `dir` sobrevive no plano de máquina com OUTRO significado, e por um motivo
 * medido: `lerArgumentos` procura a chave de dispositivo em
 * `INIT_CWD ?? process.cwd()`, que sob `systemd --user`/`launchd` é o
 * `WorkingDirectory` da unit. É a pasta ONDE A CREDENCIAL ESTÁ, nunca a raiz de
 * trabalho de projeto nenhum.
 */
type PlanoDeInstalacao =
  | { especie: 'projeto'; projectId: string; dir: string; apiUrl: string }
  | { especie: 'maquina'; dir: string; apiUrl: string; base: string };

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

  pastaDasUnidades(ctx) {
    // A MESMA precedência do systemd: `$XDG_CONFIG_HOME/systemd/user` quando a
    // variável está posta, `~/.config/systemd/user` quando não. Escolher só o
    // segundo faria a unit nascer onde o gerenciador não olha, e a falha
    // apareceria como "unit file does not exist" no `enable` — visível, mas
    // pelo motivo errado.
    const base =
      ctx.xdgConfigHome && ctx.xdgConfigHome.length > 0
        ? ctx.xdgConfigHome
        : join(ctx.home, '.config');
    return join(base, 'systemd', 'user');
  },

  nomeDoArquivo(alvo) {
    return SYSTEMD.identificador(alvo);
  },

  projetoDoArquivo(nome) {
    const casou = /^brabo-runner-(.+)\.service$/.exec(nome);
    const projectId = casou?.[1];
    // A checagem do formato é o que impede um arquivo qualquer da pasta de
    // virar "projeto instalado" numa mensagem.
    return projectId !== undefined && projectIdValidoParaServico(projectId) ? projectId : null;
  },

  identificador(alvo) {
    // Sem sufixo na máquina. Não colide com projeto nenhum por construção:
    // `PROJECT_ID_VALIDO` exige ao menos um caractere, então o nome de projeto
    // tem sempre um `-` onde este tem um `.` (travado por teste).
    return alvo.especie === 'maquina'
      ? 'brabo-runner.service'
      : `brabo-runner-${alvo.projectId}.service`;
  },

  conteudo(ctx, plano) {
    const flags =
      plano.especie === 'projeto'
        ? ['--project', plano.projectId, '--dir', plano.dir, '--api-url', plano.apiUrl]
        : // Nem `--project` nem `--dir`: é a AUSÊNCIA de `--project` que põe o
          // processo no modo de máquina (RN-544), e a raiz de cada projeto sai
          // da base. `--base` também fica de fora, de propósito — ver o bloco
          // de `Environment=` abaixo.
          ['--api-url', plano.apiUrl];
    const exec = [...ctx.comandoDoRunner, ...flags].map((parte) => `"${parte}"`).join(' ');

    const descricao =
      plano.especie === 'projeto'
        ? `brabo-runner — agente local do projeto ${plano.projectId}`
        : 'brabo-runner — agente local desta MÁQUINA (uma conexão por projeto)';

    // `XDG_CONFIG_HOME` CONGELADA, e só quando ela está posta — pelo mesmo
    // motivo do PATH, e com uma consequência maior: é ela que decide ONDE o
    // arquivo da base mora (`base.ts`), e `systemd --user` não repassa o
    // ambiente do shell de quem instalou. Sem isto, um usuário com a variável
    // apontada para fora de `~/.config` teria o serviço lendo a base errada —
    // ou nenhuma — e saindo em `uso()`. O VALOR da base não vai para a unit de
    // propósito: trocá-la continua sendo editar o arquivo e reiniciar, nunca
    // reinstalar.
    const ambiente =
      plano.especie === 'maquina' && ctx.xdgConfigHome && ctx.xdgConfigHome.length > 0
        ? [`Environment=XDG_CONFIG_HOME=${ctx.xdgConfigHome}`]
        : [];

    return [
      '# Gerado por `brabo-runner service install` (ADR 0147 ponto 5, RN-518;',
      '# unit de máquina: ADR 0154 ponto 4, RN-545).',
      '# NÃO edite à mão: `service install` sobrescreve este arquivo inteiro.',
      '#',
      '# Serviço de USUÁRIO por desenho — nunca `systemctl` de sistema, nunca root.',
      '# O runner roda com os privilégios do usuário, e é essa premissa que sustenta',
      '# as três fronteiras reais do produto (ver apps/runner/src/guard.ts).',
      '',
      '[Unit]',
      `Description=${descricao}`,
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
      ...ambiente,
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

  ativar(ctx, alvo) {
    const unidade = SYSTEMD.identificador(alvo);
    return [
      { comando: 'systemctl', args: ['--user', 'daemon-reload'] },
      { comando: 'systemctl', args: ['--user', 'enable', '--now', unidade] },
    ];
  },

  desativar(ctx, alvo) {
    return [
      {
        comando: 'systemctl',
        args: ['--user', 'disable', '--now', SYSTEMD.identificador(alvo)],
      },
    ];
  },

  depoisDeRemover() {
    return [{ comando: 'systemctl', args: ['--user', 'daemon-reload'] }];
  },

  perguntarEstado(ctx, alvo) {
    const resultado = ctx.sistema.rodar('systemctl', [
      '--user',
      'is-active',
      SYSTEMD.identificador(alvo),
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

  pastaDasUnidades(ctx) {
    return join(ctx.home, 'Library', 'LaunchAgents');
  },

  nomeDoArquivo(alvo) {
    return `${LAUNCHD.identificador(alvo)}.plist`;
  },

  projetoDoArquivo(nome) {
    const casou = /^dev\.brabo\.runner\.(.+)\.plist$/.exec(nome);
    const projectId = casou?.[1];
    return projectId !== undefined && projectIdValidoParaServico(projectId) ? projectId : null;
  },

  identificador(alvo) {
    // Ver o comentário irmão em `SYSTEMD.identificador`: `dev.brabo.runner` e
    // `dev.brabo.runner.<id>` não colidem porque o id nunca é vazio.
    return alvo.especie === 'maquina'
      ? 'dev.brabo.runner'
      : `dev.brabo.runner.${alvo.projectId}`;
  },

  conteudo(ctx, plano) {
    const flags =
      plano.especie === 'projeto'
        ? ['--project', plano.projectId, '--dir', plano.dir, '--api-url', plano.apiUrl]
        : ['--api-url', plano.apiUrl];
    const argumentos = [...ctx.comandoDoRunner, ...flags]
      .map((parte) => `      <string>${escaparXml(parte)}</string>`)
      .join('\n');

    const alvo: AlvoDaUnidade =
      plano.especie === 'projeto' ? alvoDeProjeto(plano.projectId) : ALVO_DE_MAQUINA;
    const sufixoDoLog = plano.especie === 'projeto' ? `-${plano.projectId}` : '';
    const log = join(ctx.home, 'Library', 'Logs', `brabo-runner${sufixoDoLog}.log`);

    // Mesma decisão do systemd: a variável que decide ONDE o arquivo da base
    // mora viaja congelada; o VALOR da base, não.
    const ambiente =
      plano.especie === 'maquina' && ctx.xdgConfigHome && ctx.xdgConfigHome.length > 0
        ? [
            '      <key>XDG_CONFIG_HOME</key>',
            `      <string>${escaparXml(ctx.xdgConfigHome)}</string>`,
          ]
        : [];

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '  <dict>',
      '    <key>Label</key>',
      `    <string>${escaparXml(LAUNCHD.identificador(alvo))}</string>`,
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
      ...ambiente,
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

  ativar(ctx, alvo) {
    return [
      {
        comando: 'launchctl',
        args: ['bootstrap', `gui/${ctx.uid ?? 0}`, caminhoDaUnidade(LAUNCHD, ctx, alvo)],
      },
    ];
  },

  desativar(ctx, alvo) {
    return [
      {
        comando: 'launchctl',
        args: ['bootout', `gui/${ctx.uid ?? 0}/${LAUNCHD.identificador(alvo)}`],
      },
    ];
  },

  depoisDeRemover() {
    return [];
  },

  perguntarEstado(ctx, alvo) {
    const resultado = ctx.sistema.rodar('launchctl', ['list', LAUNCHD.identificador(alvo)]);
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

/**
 * O caminho absoluto do arquivo de uma unit. Deixou de ser membro de
 * `PlataformaDeServico` (RN-545) porque as duas plataformas respondiam a mesma
 * coisa — pasta mais nome —, e manter duas implementações idênticas era a
 * oportunidade de elas divergirem quando a segunda espécie chegasse.
 */
function caminhoDaUnidade(
  plataforma: PlataformaDeServico,
  ctx: ContextoDoServico,
  alvo: AlvoDaUnidade,
): string {
  return join(plataforma.pastaDasUnidades(ctx), plataforma.nomeDoArquivo(alvo));
}

/**
 * As units de PROJETO que existem no disco, em ordem — a resposta do DISCO, e
 * só dela: nenhum gerenciador é perguntado aqui (ver o docblock do módulo,
 * seção do `status`). É o que permite `install` recusar a sobreposição e
 * `status` nomear a coexistência sem N chamadas de rede local.
 */
function projetosInstalados(
  plataforma: PlataformaDeServico,
  ctx: ContextoDoServico,
): string[] {
  const pasta = plataforma.pastaDasUnidades(ctx);
  return ctx.sistema
    .listarPasta(pasta)
    .map((nome) => plataforma.projetoDoArquivo(nome))
    .filter((projectId): projectId is string => projectId !== null)
    .sort();
}

/** A unit de MÁQUINA existe no disco? Também resposta do disco, e só dela. */
function maquinaInstalada(plataforma: PlataformaDeServico, ctx: ContextoDoServico): boolean {
  return ctx.sistema.existeArquivo(caminhoDaUnidade(plataforma, ctx, ALVO_DE_MAQUINA));
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

/** A flag que pede a espécie nova — opt-in explícito, ver o docblock. */
const FLAG_MAQUINA = '--machine';

/**
 * QUAL das duas espécies o subcomando está falando (RN-545). Não é uma
 * terceira fonte de projeto: `resolverProjeto` continua com as duas dele, e
 * esta função só diz se o pedido é sobre a unit de máquina, sobre uma de
 * projeto, sobre nenhuma (nada resolveu) ou contraditório.
 */
export type EspeciePedida =
  | { especie: 'maquina' }
  | { especie: 'projeto'; projeto: ProjetoResolvido }
  | { especie: 'nenhuma' }
  | { especie: 'contradicao' };

export function resolverEspecie(
  ctx: ContextoDoServico,
  lerConfig: (pasta: string) => { projectId: string } | null,
  pasta: string = ctx.cwd,
): EspeciePedida {
  const args = argumentos(ctx.argv);
  const querMaquina = args.informado(FLAG_MAQUINA);
  if (querMaquina && args.informado('--project')) return { especie: 'contradicao' };
  if (querMaquina) return { especie: 'maquina' };
  const projeto = resolverProjeto(ctx, lerConfig, pasta);
  return projeto ? { especie: 'projeto', projeto } : { especie: 'nenhuma' };
}

const RECUSA_DE_CONTRADICAO = [
  `${FLAG_MAQUINA} e --project são as DUAS espécies de unit, e pedir as duas de uma vez não é ` +
    'um pedido: o agente de MÁQUINA (ADR 0154) atende todos os projetos do dono da chave, e a ' +
    'unit por projeto atende exatamente um.',
  `Rode com ${FLAG_MAQUINA} para a unit desta máquina, ou com --project <id> para a de um projeto.`,
];

/** O `--machine` recusado por não haver mecanismo — e nunca um valor a ler. */
function recusaDeContradicao(): RespostaDoServico {
  return recusa(RECUSA_DE_CONTRADICAO);
}

// ---------------------------------------------------------------- install

/**
 * O que `install` sabe da BASE de projetos (RN-529/RN-545) — a forma estreita
 * de `BaseResolvida`, sem a `origem`: aqui as duas origens levam ao mesmo
 * desfecho (recusar a instalação), porque uma unit de máquina sem base sobe e
 * sai em `uso()` no primeiro boot, e instalar isso é a "instalação errada de
 * pé" que este módulo recusa em toda parte.
 */
export type BaseParaServico =
  | { estado: 'ok'; base: string }
  | { estado: 'ausente' }
  | { estado: 'recusada'; mensagem: string };

export interface DependenciasDeInstalacao {
  lerConfig: (cwd: string) => { projectId: string; apiUrl: string } | null;
  /** `lerChaveDeDispositivo` — a credencial que um serviço PODE usar. */
  lerChave: (dir: string) => { deviceKeyId: string } | null;
  /** `resolverDir` de `guard.ts` — a régua ÚNICA de caminho, nunca uma cópia. */
  resolverDir: (bruto: string, cwd: string) => string;
  /** `validarDirDentroDoHomeNoLinux` — lança quando o dir sai do $HOME (RN-434). */
  validarDir: (dir: string, plataforma: NodeJS.Platform, home: string) => void;
  /**
   * `resolverBaseConsentida` de `base.ts`, INJETADA como as quatro acima —
   * este módulo não lê disco nem ambiente por conta própria, e a base vem de
   * um arquivo de usuário. Só a unit de MÁQUINA a consulta.
   */
  resolverBase: (ctx: ContextoDoServico) => BaseParaServico;
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

  const args = argumentos(ctx.argv);
  const querMaquina = args.informado(FLAG_MAQUINA);
  if (querMaquina && args.informado('--project')) return recusaDeContradicao();

  // A SOBREPOSIÇÃO das duas espécies é checada ANTES de qualquer escrita —
  // recusar depois de gravar o arquivo deixaria de pé exatamente a instalação
  // que a recusa existe para impedir. Ver o docblock: não há `--force`.
  const sobreposicao = recusaDeSobreposicao(plataforma, ctx, querMaquina);
  if (sobreposicao) return sobreposicao;

  // A PASTA primeiro, e só então o projeto: quem manda no `install` é a pasta
  // que vai ser instalada, e é o config DELA que responde por qual projeto ela
  // é. Sem `--dir` os dois são o mesmo lugar — o uso normal, que é rodar
  // `install` de dentro da pasta configurada. No modo de MÁQUINA a pasta tem
  // outro significado (é onde a CREDENCIAL está, ver `PlanoDeInstalacao`) e o
  // mesmo tratamento: `--dir`, senão o `cwd`.
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
      querMaquina
        ? 'Registre uma chave de dispositivo de MÁQUINA nesta pasta (ADR 0154) — hoje quem ' +
          'faz isso é o instalador — e rode `brabo-runner service install --machine` ' +
          'apontando para ela com --dir.'
        : 'Use "Configurar pasta automaticamente" na tela do projeto para gravar a pasta, e ' +
          'rode `brabo-runner service install` de dentro dela.',
    ]);
  }

  const config = deps.lerConfig(dir);

  const preparado = querMaquina
    ? prepararPlanoDeMaquina(ctx, deps, dir, config !== null)
    : prepararPlanoDeProjeto(ctx, deps, dir, args.valorDe('--api-url'), config);
  if ('recusa' in preparado) return preparado.recusa;
  const { plano, alvo, extraDaCabeca } = preparado;

  if (!caminhoSeguroParaUnidade(plano.apiUrl) || /\s/.test(plano.apiUrl)) {
    return recusa([
      `--api-url recusada: ${JSON.stringify(plano.apiUrl)} tem espaço, aspa ou quebra de linha.`,
    ]);
  }

  const caminho = caminhoDaUnidade(plataforma, ctx, alvo);

  ctx.sistema.criarPasta(join(caminho, '..'));
  ctx.sistema.escreverArquivo(caminho, plataforma.conteudo(ctx, plano));

  const pendentes: string[] = [];
  for (const passo of plataforma.ativar(ctx, alvo)) {
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
    ...extraDaCabeca,
    `  pasta:   ${dir}`,
    `  api:     ${plano.apiUrl}`,
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
      `Serviço de usuário ativado (${plataforma.nome}): ${plataforma.identificador(alvo)}`,
      'Ele sobe junto com a sua sessão e roda com o SEU usuário — nunca como root.',
      alvo.especie === 'maquina'
        ? 'Confira com `brabo-runner service status --machine`. A lista de projetos é ' +
          'consultada no START (RN-544): projeto criado depois disto entra quando o serviço ' +
          'for reiniciado.'
        : 'Confira com `brabo-runner service status`.',
    ],
  };
}

/** O que uma das duas metades de `install` devolve: o plano, ou a recusa. */
type PreparoDePlano =
  | { plano: PlanoDeInstalacao; alvo: AlvoDaUnidade; extraDaCabeca: string[] }
  | { recusa: RespostaDoServico };

function prepararPlanoDeProjeto(
  ctx: ContextoDoServico,
  deps: DependenciasDeInstalacao,
  dir: string,
  apiUrlDaFlag: string | undefined,
  config: { projectId: string; apiUrl: string } | null,
): PreparoDePlano {
  const projeto = resolverProjeto(ctx, deps.lerConfig, dir);
  if (!projeto) {
    return {
      recusa: recusa([
        'brabo-runner service install precisa saber QUAL projeto instalar.',
        `Informe --project <projectId>, ou rode dentro da pasta que tem ${NOME_ARQUIVO_CONFIG} ` +
          '(a que o botão "Configurar pasta automaticamente" baixou).',
        `Para instalar o agente desta MÁQUINA, que atende todos os seus projetos em modo ` +
          `runner de uma vez (ADR 0154), use ${FLAG_MAQUINA}.`,
      ]),
    };
  }
  if (!projectIdValidoParaServico(projeto.projectId)) {
    return {
      recusa: recusa([
        `projectId recusado: ${JSON.stringify(projeto.projectId)}.`,
        'Ele vira NOME DE ARQUIVO da unit e argumento de comando, então só letras, dígitos, ' +
          '`.`, `-` e `_` (até 64 caracteres) são aceitos.',
        projeto.fonte === 'config'
          ? `O valor veio de ${NOME_ARQUIVO_CONFIG} de ${dir} — regrave a pasta pela tela do projeto.`
          : 'O valor veio de --project.',
      ]),
    };
  }

  // A precedência da api aqui fica byte a byte: flag, senão o config DAQUELA
  // pasta, senão o default. `BRABO_API_URL` não entra — ver `apiUrlDoAmbiente`.
  const apiUrl = apiUrlDaFlag ?? config?.apiUrl ?? 'http://localhost:3000';
  return {
    plano: { especie: 'projeto', projectId: projeto.projectId, dir, apiUrl },
    alvo: alvoDeProjeto(projeto.projectId),
    extraDaCabeca: [`  projeto: ${projeto.projectId}`],
  };
}

/**
 * A metade nova (RN-545). Ela recusa mais do que a de projeto, e as duas
 * recusas próprias são medidas, não zelo:
 *
 * 1. **`brabo-runner.config.json` na pasta.** `lerArgumentos` resolve o
 *    `projectId` por esse arquivo quando `--project` falta, e o modo de máquina
 *    é justamente "sem `projectId`" — uma unit de máquina cujo
 *    `WorkingDirectory` tenha esse arquivo subiria o processo em modo PROJETO,
 *    em silêncio, atendendo UM projeto e chamando-se agente da máquina.
 * 2. **Sem base consentida.** O modo de máquina EXIGE base (RN-544) e sai em
 *    `uso()` sem ela. Instalar assim seria gravar um serviço que nunca sobe.
 */
function prepararPlanoDeMaquina(
  ctx: ContextoDoServico,
  deps: DependenciasDeInstalacao,
  dir: string,
  temConfigDeProjeto: boolean,
): PreparoDePlano {
  if (temConfigDeProjeto) {
    return {
      recusa: recusa([
        `A pasta ${dir} tem um ${NOME_ARQUIVO_CONFIG}, e por isso NÃO pode ser a pasta do ` +
          'agente de máquina.',
        `Esse arquivo é por PROJETO: o runner lê o projectId dele quando --project falta, ` +
          'então o serviço subiria em modo de projeto — atendendo um só — com nome de agente ' +
          'da máquina. O sintoma seria silencioso, e é por isso que a recusa é aqui.',
        'Aponte --dir para uma pasta que tenha só a chave de dispositivo de MÁQUINA.',
      ]),
    };
  }

  const base = deps.resolverBase(ctx);
  if (base.estado === 'recusada') {
    return {
      recusa: recusa([
        base.mensagem,
        'Sem base consentida o agente de máquina não sobe (RN-544), então a unit NÃO foi ' +
          'gravada: instalar um serviço que sai no primeiro boot é pior que não instalar.',
      ]),
    };
  }
  if (base.estado === 'ausente') {
    return {
      recusa: recusa([
        'Não há BASE de projetos consentida nesta máquina, e o agente de máquina não roda sem ' +
          'uma: é dela que a pasta de cada projeto é derivada (<base>/<workspaceDirName>).',
        'Rode o instalador para consentir uma base, ou grave-a em ' +
          '$XDG_CONFIG_HOME/brabo/runner.json (senão ~/.config/brabo/runner.json).',
      ]),
    };
  }

  const apiUrl =
    argumentos(ctx.argv).valorDe('--api-url') ??
    ctx.apiUrlDoAmbiente ??
    'http://localhost:3000';

  return {
    plano: { especie: 'maquina', dir, apiUrl, base: base.base },
    alvo: ALVO_DE_MAQUINA,
    extraDaCabeca: [
      '  espécie: MÁQUINA (uma conexão por projeto, ADR 0154)',
      `  base:    ${base.base}`,
    ],
  };
}

/**
 * A recusa de SOBREPOSIÇÃO das duas espécies, ou `null` quando não há.
 * Resposta do DISCO — ver o docblock do módulo. Nada é removido aqui: a unit
 * que já existe fica intacta, e o que a mensagem entrega é o comando de
 * remoção de cada uma.
 */
function recusaDeSobreposicao(
  plataforma: PlataformaDeServico,
  ctx: ContextoDoServico,
  querMaquina: boolean,
): RespostaDoServico | null {
  if (querMaquina) {
    const projetos = projetosInstalados(plataforma, ctx);
    if (projetos.length === 0) return null;
    return recusa([
      `Há ${projetos.length} unit(s) por PROJETO instalada(s) nesta máquina, e o agente de ` +
        'máquina atende TODOS os seus projetos em modo runner — os dois disputariam o mesmo ' +
        'projeto, e o servidor negaria um deles (um runner por projeto).',
      'Remova a(s) que existe(m) e instale de novo:',
      ...projetos.map((projectId) => `  brabo-runner service uninstall --project ${projectId}`),
      'Nada foi removido nem gravado agora — a instalação atual continua exatamente como estava.',
    ]);
  }

  if (!maquinaInstalada(plataforma, ctx)) return null;
  return recusa([
    'Já há uma unit de MÁQUINA instalada, e ela atende TODOS os seus projetos em modo runner ' +
      '— inclusive este. Instalar a unit por projeto poria dois processos disputando o mesmo ' +
      'projeto, e o servidor negaria um deles (um runner por projeto).',
    `Se quiser mesmo a unit deste projeto, remova antes a de máquina: ` +
      `brabo-runner service uninstall ${FLAG_MAQUINA}`,
    'Nada foi removido nem gravado agora — a instalação atual continua exatamente como estava.',
  ]);
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

  const pedido = resolverEspecie(ctx, deps.lerConfig);
  if (pedido.especie === 'contradicao') return recusaDeContradicao();
  // `uninstall` NÃO herda o default de máquina que `status` tem: ler a espécie
  // errada custa uma linha errada, remover a espécie errada custa um serviço e
  // uma chave de dispositivo. Sem espécie nomeada ele recusa — e diz o que
  // existe, para o próximo comando não ser outro chute.
  if (pedido.especie === 'nenhuma') {
    return recusa([
      'brabo-runner service uninstall precisa saber O QUE remover, e não adivinha: remover a ' +
        'unit errada apaga também o config e a chave de dispositivo daquela pasta.',
      `Informe --project <projectId>, rode dentro da pasta que tem ${NOME_ARQUIVO_CONFIG}, ou ` +
        `use ${FLAG_MAQUINA} para a unit desta máquina.`,
      ...linhasDoQueExiste(plataforma, ctx),
    ]);
  }
  if (
    pedido.especie === 'projeto' &&
    !projectIdValidoParaServico(pedido.projeto.projectId)
  ) {
    return recusa([
      `projectId recusado: ${JSON.stringify(pedido.projeto.projectId)}.`,
      'Ele vira NOME DE ARQUIVO da unit, então só letras, dígitos, `.`, `-` e `_` (até 64 ' +
        'caracteres) são aceitos.',
    ]);
  }

  const alvo: AlvoDaUnidade =
    pedido.especie === 'maquina' ? ALVO_DE_MAQUINA : alvoDeProjeto(pedido.projeto.projectId);
  const descricaoDoAlvo =
    alvo.especie === 'maquina' ? 'o agente desta MÁQUINA' : `o projeto ${alvo.projectId}`;

  const caminho = caminhoDaUnidade(plataforma, ctx, alvo);
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
    linhas.push(`Não há unit instalada para ${descricaoDoAlvo} (${caminho} não existe).`);
  } else {
    for (const passo of plataforma.desativar(ctx, alvo)) {
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
    for (const passo of plataforma.depoisDeRemover(ctx, alvo)) {
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
  alvo: AlvoDaUnidade,
): RelatorioDeStatus | null {
  const plataforma = plataformaDe(ctx.plataforma);
  if (!plataforma) return null;

  const caminho = caminhoDaUnidade(plataforma, ctx, alvo);
  // O DISCO responde "instalado?" — e essa resposta continua certa numa máquina
  // onde o gerenciador não existe. Só depois se pergunta ao gerenciador.
  if (!ctx.sistema.existeArquivo(caminho)) {
    return { estado: 'nao-instalado', caminho, detalhe: 'não há arquivo de unit' };
  }

  const resposta = plataforma.perguntarEstado(ctx, alvo);
  return { estado: resposta.estado, caminho, detalhe: resposta.detalhe };
}

const FRASE_POR_ESTADO: Record<EstadoDoServico, string> = {
  'nao-instalado': 'NÃO INSTALADO — não há serviço de usuário para este alvo nesta máquina.',
  rodando: 'INSTALADO E RODANDO — o agente local está de pé agora.',
  parado: 'INSTALADO E PARADO — a unit existe, e o serviço não está rodando.',
  'nao-consegui-perguntar':
    'INSTALADO, E NÃO CONSEGUI PERGUNTAR se está rodando — a unit existe no disco e o ' +
    'gerenciador de serviços não respondeu. Isto NÃO quer dizer que está parado.',
};

/**
 * O que existe no DISCO, das duas espécies — as linhas que `uninstall` usa na
 * recusa e `status` usa no bloco de coexistência. Nenhum gerenciador é
 * perguntado, e as linhas DIZEM isso: um "existe" do disco e um "está rodando"
 * do gerenciador são respostas diferentes, e fundi-las aqui faria a segunda
 * parecer barata (seriam N chamadas) e certa (não foi perguntada).
 */
function linhasDoQueExiste(
  plataforma: PlataformaDeServico,
  ctx: ContextoDoServico,
): string[] {
  const projetos = projetosInstalados(plataforma, ctx);
  const maquina = maquinaInstalada(plataforma, ctx);
  if (projetos.length === 0 && !maquina) {
    return ['Não há unit nenhuma instalada nesta máquina (nem de projeto, nem de máquina).'];
  }
  return [
    'Units encontradas no disco (o estado de cada uma NÃO foi perguntado ao gerenciador):',
    ...(maquina ? [`  ${FLAG_MAQUINA} — ${plataforma.identificador(ALVO_DE_MAQUINA)}`] : []),
    ...projetos.map(
      (projectId) =>
        `  --project ${projectId} — ${plataforma.identificador(alvoDeProjeto(projectId))}`,
    ),
  ];
}

/**
 * As units da OUTRA espécie, ditas em texto e NUNCA somadas ao código de saída
 * (ver o docblock do módulo). É o ponto 5 do ADR 0154: deixar seis processos
 * disputando três projetos em silêncio é o defeito que este bloco existe para
 * impedir.
 */
function linhasDeCoexistencia(
  plataforma: PlataformaDeServico,
  ctx: ContextoDoServico,
  principal: AlvoDaUnidade,
): string[] {
  if (principal.especie === 'maquina') {
    const projetos = projetosInstalados(plataforma, ctx);
    if (projetos.length === 0) return [];
    return [
      '',
      `ATENÇÃO: há também ${projetos.length} unit(s) por PROJETO instalada(s) — o agente de ` +
        'máquina já atende esses projetos, e os dois processos disputariam cada um deles ' +
        '(o servidor nega um dos dois).',
      ...projetos.map(
        (projectId) => `  brabo-runner service uninstall --project ${projectId}`,
      ),
      'Presença lida do DISCO; o estado de cada uma não foi perguntado ao gerenciador.',
    ];
  }

  if (!maquinaInstalada(plataforma, ctx)) return [];
  return [
    '',
    'ATENÇÃO: há também uma unit de MÁQUINA instalada, e ela atende TODOS os seus projetos ' +
      'em modo runner — inclusive este. Os dois processos disputariam este projeto.',
    `  brabo-runner service status ${FLAG_MAQUINA}`,
    'Presença lida do DISCO; o estado dela não foi perguntado ao gerenciador.',
  ];
}

export function status(ctx: ContextoDoServico, deps: DependenciasDeStatus): RespostaDoServico {
  const plataforma = plataformaDe(ctx.plataforma);
  if (!plataforma) return recusaDePlataforma(ctx.plataforma);

  const pedido = resolverEspecie(ctx, deps.lerConfig);
  if (pedido.especie === 'contradicao') return recusaDeContradicao();
  if (pedido.especie === 'projeto' && !projectIdValidoParaServico(pedido.projeto.projectId)) {
    return recusa([
      `projectId recusado: ${JSON.stringify(pedido.projeto.projectId)}.`,
      'Ele vira NOME DE ARQUIVO da unit, então só letras, dígitos, `.`, `-` e `_` (até 64 ' +
        'caracteres) são aceitos.',
    ]);
  }

  // Sem espécie nomeada, o principal é a MÁQUINA: é a única unit cujo nome não
  // precisa de argumento, e antes desta RN a mesma entrada respondia "precisa
  // saber QUAL projeto" — uma pergunta, e não uma resposta, para quem tem
  // exatamente a instalação que o instalador produz. Quem queria a outra é
  // avisado na linha seguinte.
  const alvo: AlvoDaUnidade =
    pedido.especie === 'projeto' ? alvoDeProjeto(pedido.projeto.projectId) : ALVO_DE_MAQUINA;

  const relatorio = consultarStatus(ctx, alvo);
  /* c8 ignore next */
  if (!relatorio) return recusaDePlataforma(ctx.plataforma);

  const titulo =
    alvo.especie === 'maquina'
      ? `agente de MÁQUINA (ADR 0154) — ${plataforma.nome}`
      : `projeto ${alvo.projectId} — ${plataforma.nome}`;
  const semArgumento =
    pedido.especie === 'nenhuma'
      ? [
          `Nenhum projeto foi informado nem encontrado em ${NOME_ARQUIVO_CONFIG}: a resposta ` +
            'acima é sobre a unit desta MÁQUINA. Para perguntar por um projeto, use ' +
            '--project <projectId>.',
        ]
      : [];

  return {
    fluxo: 'saida',
    codigo: CODIGO_POR_ESTADO[relatorio.estado],
    linhas: [
      titulo,
      FRASE_POR_ESTADO[relatorio.estado],
      `  unit:    ${relatorio.caminho}`,
      `  detalhe: ${relatorio.detalhe}`,
      `  código de saída: ${CODIGO_POR_ESTADO[relatorio.estado]} (um por estado — nunca colapsados)`,
      ...semArgumento,
      ...linhasDeCoexistencia(plataforma, ctx, alvo),
    ],
  };
}

// ------------------------------------------------------------- subcomando

export function ehSubcomandoConhecido(valor: string | undefined): valor is Subcomando {
  return valor !== undefined && (SUBCOMANDOS as readonly string[]).includes(valor);
}

export function usoDeServico(): RespostaDoServico {
  return recusa([
    'uso: brabo-runner service <install|uninstall|status> [--machine | --project <id>] ' +
      '[--dir <pasta>]',
    '',
    'install   — instala o runner como serviço de USUÁRIO (systemd --user no Linux, ' +
      'LaunchAgent no macOS). Nunca serviço de sistema, nunca root.',
    'uninstall — remove a unit, o brabo-runner.config.json e a chave de dispositivo DESTE ' +
      'disco (a revogação no servidor é outra coisa, feita pela tela do projeto).',
    'status    — diz um de quatro estados, sem colapsar nenhum: não instalado, instalado e ' +
      'rodando, instalado e parado, ou instalado e não consegui perguntar.',
    '',
    'DUAS espécies de unit, e elas convivem (ADR 0154 ponto 4, RN-545):',
    `  ${FLAG_MAQUINA}        a unit desta MÁQUINA — um processo que atende TODOS os seus ` +
      'projetos em modo runner, uma conexão para cada. Exige base consentida e uma chave de ' +
      'dispositivo de máquina.',
    '  --project <id>   a unit de UM projeto — o comportamento de sempre. Sem a flag, o ' +
      'projeto sai do brabo-runner.config.json da pasta.',
    'As duas juntas seriam dois processos disputando o mesmo projeto, então `install` recusa ' +
      'quando a outra já existe, e `status` diz que ela está lá.',
    '',
    'Windows fica fora de escopo por decisão declarada (ADR 0147 ponto 5).',
  ]);
}
