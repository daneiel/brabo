import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  instalar,
  type BaseParaServico,
  type ContextoDoServico,
  type ResultadoDeComando,
  type SistemaDeServico,
} from './servico.ts';

/**
 * A unit gerada é perguntada ao VALIDADOR DE VERDADE, não a uma expectativa de
 * string.
 *
 * `servico.spec.ts` prova que o gerador escreve o que aquele teste espera — o
 * que é outra coisa que provar que o systemd ACEITA o resultado. A diferença
 * custou uma release: a unit saía com `WorkingDirectory="/home/…"`, e como o
 * systemd NÃO faz unquoting nessa diretiva, o valor deixava de começar com `/`
 * e a unit era recusada na carga (`bad-setting`, `path is not absolute`). Ela
 * NUNCA iniciou, em instalação nenhuma, nas duas espécies — e a suíte inteira
 * estava verde, porque cada asserção pedia de volta exatamente a forma errada.
 *
 * Por isso este arquivo mora separado: ele é a única parte da suíte do runner
 * que TOCA a máquina (chama `systemd-analyze`), o que `servico.spec.ts` declara
 * no docblock que não faz. Onde não há systemd — macOS, Windows, container sem
 * o binário — o teste PULA NOMEANDO o motivo, nunca passa em silêncio nem
 * reprova por ambiente; o `ubuntu-latest` do CI tem systemd e roda de verdade.
 *
 * `--user` porque é o único escopo que o produto usa (RN-518: serviço de
 * usuário sempre, root recusado).
 */

function motivoParaPular(): string | null {
  if (process.platform !== 'linux') {
    return `systemd-analyze só existe no Linux, e esta máquina é ${process.platform}`;
  }
  try {
    execFileSync('systemd-analyze', ['--version'], { stdio: 'ignore' });
    return null;
  } catch {
    return 'systemd-analyze não está no PATH desta máquina';
  }
}

const PULAR = motivoParaPular();

/** Roda o validador REAL sobre o texto de unit recebido. */
function verificarNoSystemd(nomeDoArquivo: string, conteudo: string): {
  codigo: number;
  saida: string;
} {
  const pasta = mkdtempSync(join(tmpdir(), 'brabo-unit-'));
  const caminho = join(pasta, nomeDoArquivo);
  writeFileSync(caminho, conteudo, 'utf8');
  const r = spawnSync('systemd-analyze', ['--user', 'verify', caminho], {
    encoding: 'utf8',
  });
  return { codigo: r.status ?? -1, saida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ------------------------------------------------ o gerador, sem mock nenhum

const PROJETO = '11111111-2222-3333-4444-555555555555';
const HOME = '/home/dev';

class SistemaFalso implements SistemaDeServico {
  arquivos = new Map<string, string>();
  lerArquivo(caminho: string): string | null {
    return this.arquivos.get(caminho) ?? null;
  }
  criarPasta(): void {}
  escreverArquivo(caminho: string, conteudo: string): void {
    this.arquivos.set(caminho, conteudo);
  }
  apagarArquivo(caminho: string): boolean {
    return this.arquivos.delete(caminho);
  }
  existeArquivo(caminho: string): boolean {
    return this.arquivos.has(caminho);
  }
  listarPasta(): string[] {
    return [];
  }
  rodar(): ResultadoDeComando {
    return { estado: 'executou', codigo: 0, saida: '' };
  }
}

/**
 * `comandoDoRunner` aponta para o Node que está rodando a suíte, e isso NÃO é
 * detalhe: `systemd-analyze verify` reprova (código 1) um `ExecStart=` cujo
 * binário não existe — medido —, então um caminho fictício faria o teste
 * vermelho pelo motivo errado.
 */
function contexto(cwd: string, argv: string[], sistema: SistemaFalso): ContextoDoServico {
  return {
    argv: ['node', 'x', 'service', ...argv],
    cwd,
    plataforma: 'linux',
    home: HOME,
    xdgConfigHome: null,
    uid: 1000,
    comandoDoRunner: [process.execPath, '/opt/brabo/index.cjs'],
    path: '/usr/local/bin:/usr/bin:/bin',
    apiUrlDoAmbiente: null,
    sistema,
  };
}

const BASE_CONSENTIDA: BaseParaServico = { estado: 'ok', base: `${HOME}/projetos` };

const depsDeProjeto = {
  lerConfig: () => ({ projectId: PROJETO, apiUrl: 'https://brabo.example' }),
  lerChave: () => ({ deviceKeyId: 'chave-123' }),
  resolverDir: (bruto: string, cwd: string) => resolve(cwd, bruto),
  validarDir: () => {},
  resolverBase: () => BASE_CONSENTIDA,
};

const depsDeMaquina = { ...depsDeProjeto, lerConfig: () => null };

function unitDeProjeto(cwd: string): string {
  const sistema = new SistemaFalso();
  const resposta = instalar(contexto(cwd, ['install'], sistema), depsDeProjeto);
  expect(resposta.codigo).toBe(0);
  const unit = sistema.arquivos.get(
    `${HOME}/.config/systemd/user/brabo-runner-${PROJETO}.service`,
  );
  expect(unit).toBeDefined();
  return unit as string;
}

function unitDeMaquina(cwd: string): string {
  const sistema = new SistemaFalso();
  const resposta = instalar(contexto(cwd, ['install', '--machine'], sistema), depsDeMaquina);
  expect(resposta.codigo).toBe(0);
  const unit = sistema.arquivos.get(`${HOME}/.config/systemd/user/brabo-runner.service`);
  expect(unit).toBeDefined();
  return unit as string;
}

describe('a unit gerada é ACEITA pelo systemd de verdade (AT-084)', () => {
  it('unit de PROJETO passa em systemd-analyze --user verify', (ctx) => {
    if (PULAR) ctx.skip(PULAR);

    const r = verificarNoSystemd(
      `brabo-runner-${PROJETO}.service`,
      unitDeProjeto(`${HOME}/projetos/meu-app`),
    );
    expect(r.saida).not.toContain('bad unit file setting');
    expect(r.codigo).toBe(0);
  });

  it('unit de MÁQUINA passa em systemd-analyze --user verify', (ctx) => {
    if (PULAR) ctx.skip(PULAR);

    const r = verificarNoSystemd(
      'brabo-runner.service',
      unitDeMaquina(`${HOME}/.config/brabo`),
    );
    expect(r.saida).not.toContain('bad unit file setting');
    expect(r.codigo).toBe(0);
  });

  it('pasta com ESPAÇO é aceita — a linha inteira é o caminho, e espaço não se escapa', (ctx) => {
    if (PULAR) ctx.skip(PULAR);

    const r = verificarNoSystemd(
      'brabo-runner.service',
      unitDeMaquina(`${HOME}/minha pasta/brabo`),
    );
    expect(r.codigo).toBe(0);
  });

  /**
   * Este é o caso que `verify` NÃO pega, e por isso ele é asserido nos dois
   * níveis: `WorkingDirectory=` passa por expansão de especificador, então um
   * `%` cru vira outra coisa (`%o` = o ID do os-release) e o resultado
   * continua sendo um caminho absoluto — a unit SOBE, na pasta errada. O que
   * o validador prova aqui é que `%%` é sintaxe legal; o que a asserção de
   * texto prova é que o gerador de fato escreve `%%`.
   */
  it('% na pasta sai escapado como %% — senão o systemd o expande em silêncio', (ctx) => {
    if (PULAR) ctx.skip(PULAR);

    const unit = unitDeMaquina(`${HOME}/50%off/brabo`);
    expect(unit).toContain(`\nWorkingDirectory=${HOME}/50%%off/brabo\n`);
    expect(verificarNoSystemd('brabo-runner.service', unit).codigo).toBe(0);
  });

  /**
   * A MUTAÇÃO, fixada: a forma antiga é reprovada por este mesmo validador.
   * Sem isto, alguém que reintroduzisse as aspas só descobriria na máquina de
   * quem instala — que foi exatamente o que aconteceu.
   */
  it('a forma ANTIGA, entre aspas, é REPROVADA pelo mesmo validador', (ctx) => {
    if (PULAR) ctx.skip(PULAR);

    const comAspas = unitDeMaquina(`${HOME}/.config/brabo`).replace(
      /^WorkingDirectory=(.*)$/m,
      'WorkingDirectory="$1"',
    );
    const r = verificarNoSystemd('brabo-runner.service', comAspas);
    expect(r.codigo).not.toBe(0);
    expect(r.saida).toContain('WorkingDirectory= path is not absolute');
  });
});

// ------------------------------------------- o valor EFETIVO, pelo parser real

/**
 * AT-095. `verify` responde "a unit carrega?", e para `Environment=` isso não
 * basta: `Environment=XDG_CONFIG_HOME=/home/dan/50%off com espaco` CARREGA,
 * `verify` aprova, o serviço sobe — e o valor efetivo é `/home/dan/50popff`
 * (`%o` expandido, `com` e `espaco` descartados pela separação em palavras). A
 * pergunta certa é "que valor o systemd ENTENDEU?", e quem responde é o próprio
 * gerenciador em modo de teste: `systemd --test --user --unit=<u>` carrega a
 * unit pelo mesmo parser do serviço de verdade e DESPEJA a configuração
 * resolvida (`Environment:`, `WorkingDirectory:`, `Command Line:`), sem subir
 * nada e sem tocar o gerenciador da sessão de quem roda a suíte — a pasta de
 * units é uma pasta temporária (`SYSTEMD_UNIT_PATH`), o `XDG_RUNTIME_DIR` também.
 *
 * `basic.target` e `shutdown.target` entram como STUBS na pasta: são as
 * dependências padrão de um serviço de usuário, e sem elas o modo de teste
 * recusa montar a transação. Nada na unit gerada depende do conteúdo delas.
 */

const BINARIOS_DO_SYSTEMD = ['/usr/lib/systemd/systemd', '/lib/systemd/systemd'];

interface ConfiguracaoEfetiva {
  environment: Map<string, string>;
  workingDirectory: string | null;
  commandLine: string | null;
}

function despejarNoSystemd(
  binario: string,
  nomeDoArquivo: string,
  conteudo: string,
): { codigo: number; saida: string; efetiva: ConfiguracaoEfetiva | null } {
  const pasta = mkdtempSync(join(tmpdir(), 'brabo-u-'));
  const runtime = mkdtempSync(join(tmpdir(), 'brabo-r-'));
  writeFileSync(join(pasta, nomeDoArquivo), conteudo, 'utf8');
  writeFileSync(join(pasta, 'basic.target'), '[Unit]\nDescription=stub\n', 'utf8');
  writeFileSync(
    join(pasta, 'shutdown.target'),
    '[Unit]\nDescription=stub\nDefaultDependencies=no\n',
    'utf8',
  );
  const r = spawnSync(binario, ['--test', '--user', '--no-pager', `--unit=${nomeDoArquivo}`], {
    encoding: 'utf8',
    // Ambiente MÍNIMO e explícito: nada do shell de quem roda a suíte entra.
    env: {
      HOME: pasta,
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      XDG_RUNTIME_DIR: runtime,
      SYSTEMD_UNIT_PATH: pasta,
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { codigo: r.status ?? -1, saida, efetiva: lerSecaoDaUnit(r.stdout ?? '', nomeDoArquivo) };
}

/** Recorta do despejo a seção da unit pedida e lê os três campos. */
function lerSecaoDaUnit(despejo: string, nomeDoArquivo: string): ConfiguracaoEfetiva | null {
  const linhas = despejo.split('\n');
  const inicio = linhas.indexOf(`\t-> Unit ${nomeDoArquivo}:`);
  if (inicio < 0) return null;
  const efetiva: ConfiguracaoEfetiva = {
    environment: new Map(),
    workingDirectory: null,
    commandLine: null,
  };
  for (let i = inicio + 1; i < linhas.length; i++) {
    const linha = linhas[i] as string;
    if (linha.startsWith('\t-> Unit ')) break;
    const env = /^\t\tEnvironment: (.*)$/.exec(linha)?.[1];
    if (env !== undefined) {
      const igual = env.indexOf('=');
      efetiva.environment.set(env.slice(0, igual), env.slice(igual + 1));
    }
    const wd = /^\t\tWorkingDirectory: (.*)$/.exec(linha)?.[1];
    if (wd !== undefined) efetiva.workingDirectory = wd;
    const cmd = /^\t\t\tCommand Line: (.*)$/.exec(linha)?.[1];
    if (cmd !== undefined && efetiva.commandLine === null) efetiva.commandLine = cmd;
  }
  return efetiva;
}

/**
 * O motivo de pular é NOMEADO, e a sonda roda uma unit trivial: se o modo de
 * teste não existe nesta versão do systemd, ou não consegue montar um
 * gerenciador aqui, o teste diz isso em vez de reprovar por ambiente.
 */
function motivoParaPularOModoDeTeste(): { pular: string | null; binario: string } {
  if (process.platform !== 'linux') {
    return { pular: `systemd só existe no Linux, e esta máquina é ${process.platform}`, binario: '' };
  }
  const binario = BINARIOS_DO_SYSTEMD.find((b) => existsSync(b));
  if (!binario) {
    return {
      pular: `nenhum binário do systemd em ${BINARIOS_DO_SYSTEMD.join(' ou ')}`,
      binario: '',
    };
  }
  const sonda = despejarNoSystemd(
    binario,
    'brabo-sonda.service',
    '[Service]\nExecStart=/bin/true\nEnvironment="SONDA=ok"\n',
  );
  if (sonda.efetiva?.environment.get('SONDA') !== 'ok') {
    return {
      pular:
        `\`${binario} --test --user\` não despejou a configuração nesta máquina ` +
        `(código ${sonda.codigo}): ${sonda.saida.split('\n').slice(0, 3).join(' | ')}`,
      binario,
    };
  }
  return { pular: null, binario };
}

const MODO_DE_TESTE = motivoParaPularOModoDeTeste();
// Os testes abaixo também chamam `verify`, então pulam se QUALQUER dos dois faltar.
const PULAR_O_DESPEJO = MODO_DE_TESTE.pular ?? PULAR;

function unitDeMaquinaCom(cwd: string, xdgConfigHome: string): string {
  const sistema = new SistemaFalso();
  const ctx = { ...contexto(cwd, ['install', '--machine'], sistema), xdgConfigHome };
  const resposta = instalar(ctx, depsDeMaquina);
  expect(resposta.codigo).toBe(0);
  const unit = sistema.arquivos.get(`${xdgConfigHome}/systemd/user/brabo-runner.service`);
  expect(unit).toBeDefined();
  return unit as string;
}

function unitDeProjetoCom(cwd: string, path: string): string {
  const sistema = new SistemaFalso();
  const ctx = { ...contexto(cwd, ['install'], sistema), path };
  const resposta = instalar(ctx, depsDeProjeto);
  expect(resposta.codigo).toBe(0);
  const unit = sistema.arquivos.get(
    `${HOME}/.config/systemd/user/brabo-runner-${PROJETO}.service`,
  );
  expect(unit).toBeDefined();
  return unit as string;
}

function efetivaDe(nomeDoArquivo: string, unit: string): ConfiguracaoEfetiva {
  const r = despejarNoSystemd(MODO_DE_TESTE.binario, nomeDoArquivo, unit);
  expect(r.efetiva, r.saida.slice(0, 2000)).not.toBeNull();
  return r.efetiva as ConfiguracaoEfetiva;
}

/** Os caracteres que cada régua trata de um jeito: `%`, espaço, aspas, barra. */
const PASTAS_DIFICEIS = [
  `${HOME}/50%off com espaco`,
  `${HOME}/aspas "duplas" e 'simples'`,
  `${HOME}/barra\\invertida\\n`,
  `${HOME}/tudo %o %% "x" \\ $HOME fim`,
  // Sem aspa dupla de propósito: é a que chega ao `--dir` do ExecStart=, onde
  // `$` é substituição de variável.
  `${HOME}/dolar $HOME e \${HOME} sem aspa`,
];

describe('o valor EFETIVO de Environment= é o valor gravado (AT-095)', () => {
  it.for(PASTAS_DIFICEIS)('XDG_CONFIG_HOME=%j chega inteiro ao serviço de MÁQUINA', (xdg, ctx) => {
    if (PULAR_O_DESPEJO) ctx.skip(PULAR_O_DESPEJO);

    const unit = unitDeMaquinaCom(`${HOME}/.config/brabo`, xdg);
    expect(verificarNoSystemd('brabo-runner.service', unit).codigo).toBe(0);
    const efetiva = efetivaDe('brabo-runner.service', unit);
    expect(efetiva.environment.get('XDG_CONFIG_HOME')).toBe(xdg);
    // O PATH, na mesma unit, também sobrevive intacto.
    expect(efetiva.environment.get('PATH')).toBe('/usr/local/bin:/usr/bin:/bin');
  });

  it.for(PASTAS_DIFICEIS)('PATH com %j chega inteiro ao serviço de PROJETO', (pasta, ctx) => {
    if (PULAR_O_DESPEJO) ctx.skip(PULAR_O_DESPEJO);

    const path = `/usr/bin:${pasta}/bin:/bin`;
    const unit = unitDeProjetoCom(`${HOME}/projetos/meu-app`, path);
    const efetiva = efetivaDe(`brabo-runner-${PROJETO}.service`, unit);
    expect(efetiva.environment.get('PATH')).toBe(path);
    // E a de projeto NÃO grava XDG_CONFIG_HOME (só a de máquina congela).
    expect(efetiva.environment.has('XDG_CONFIG_HOME')).toBe(false);
  });

  /**
   * A forma ANTIGA, fixada como reprovada pelo mesmo parser — não por
   * `verify`, que a APROVA (é exatamente o defeito). O valor exato depende do
   * ID do os-release (`%o`), então a asserção é sobre o que se PERDEU.
   */
  it('a forma ANTIGA (sem aspas, sem %%) entrega ao serviço OUTRO valor', (ctx) => {
    if (PULAR_O_DESPEJO) ctx.skip(PULAR_O_DESPEJO);

    const xdg = `${HOME}/50%off com espaco`;
    const antiga = unitDeMaquinaCom(`${HOME}/.config/brabo`, xdg).replace(
      /^Environment="XDG_CONFIG_HOME=.*"$/m,
      `Environment=XDG_CONFIG_HOME=${xdg}`,
    );
    expect(antiga).toContain(`\nEnvironment=XDG_CONFIG_HOME=${xdg}\n`);
    expect(verificarNoSystemd('brabo-runner.service', antiga).codigo).toBe(0);

    const efetivo = efetivaDe('brabo-runner.service', antiga).environment.get('XDG_CONFIG_HOME');
    expect(efetivo).not.toBe(xdg);
    expect(efetivo).not.toContain('%');
    expect(efetivo).not.toContain('espaco');
  });
});

/**
 * A MESMA classe nas outras duas diretivas que carregam caminho: o `--dir` do
 * `ExecStart=` (que expande `%` na carga e trata `\` como escape) e o
 * `WorkingDirectory=` (AT-084). Perguntadas ao mesmo despejo, com os mesmos
 * caminhos — menos a aspa dupla, que `caminhoSeguroParaUnidade` recusa em
 * pasta de projeto antes de qualquer escrita.
 */
describe('o --dir do ExecStart= e o WorkingDirectory= também chegam intactos (AT-095)', () => {
  const PASTAS_SEM_ASPA_DUPLA = PASTAS_DIFICEIS.filter((p) => !p.includes('"'));

  it.for(PASTAS_SEM_ASPA_DUPLA)('pasta de projeto %j', (pasta, ctx) => {
    if (PULAR_O_DESPEJO) ctx.skip(PULAR_O_DESPEJO);

    const unit = unitDeProjetoCom(pasta, '/usr/bin:/bin');
    expect(verificarNoSystemd(`brabo-runner-${PROJETO}.service`, unit).codigo).toBe(0);
    const efetiva = efetivaDe(`brabo-runner-${PROJETO}.service`, unit);
    expect(efetiva.workingDirectory).toBe(pasta);
    // O despejo re-cita cada argumento (aspas e `\\` para a barra); o `$` do
    // ExecStart só é resolvido no exec, então aparece como o `$$` gravado.
    const citada = pasta.replaceAll('\\', '\\\\').replaceAll('$', '\\$\\$');
    expect(efetiva.commandLine).toContain(`--dir "${citada}"`);
  });
});
