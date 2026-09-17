import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
