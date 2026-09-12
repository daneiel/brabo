import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOME_ARQUIVO_CHAVE, NOME_ARQUIVO_CONFIG } from './device-key.ts';

/**
 * O único teste do repositório que roda o CLI DE VERDADE — processo separado,
 * `cwd` real, saída real — e existe por um motivo específico (RN-475): o
 * defeito que ele tranca não vivia em nenhuma função, vivia na JUNÇÃO delas.
 * `lerChaveDeDispositivo` devolvia `null` (correto, e testado), `uso()`
 * imprimia o bloco de flags (correto, e óbvio), e a soma dos dois fazia uma
 * pasta configurada-e-quebrada ficar indistinguível de uma pasta nunca
 * configurada. Nenhum teste de unidade dos dois lados pegaria isso.
 *
 * Roda sem rede: os dois casos saem em `lerArgumentos`, antes de qualquer
 * ticket, socket ou `node-pty`. Só os casos de FALHA de credencial rodam
 * aqui, e por isso: uma chave bem formada seguiria para o laço de conexão
 * com backoff (minutos até desistir) — esse caminho continua sendo coberto
 * por unidade em `device-key.spec.ts`, sem processo nenhum.
 *
 * A pasta temporária mora dentro do `$HOME` de propósito — no Linux a RN-434
 * recusa `--dir` fora dele, e essa recusa acontece ANTES da checagem de
 * credencial. Um `tmpdir()` faria os dois casos falharem pelo motivo errado,
 * e o teste passaria a provar a RN-434 sem saber.
 */

const CLI = fileURLToPath(new URL('./index.ts', import.meta.url));

function rodarNaPasta(
  cwd: string,
  extras: string[] = [],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const resultado = spawnSync(process.execPath, [CLI, ...extras], {
    cwd,
    encoding: 'utf-8',
    // `INIT_CWD` vence `process.cwd()` em `lerArgumentos` — o vitest o herda
    // do pnpm que o invocou, e sem limpá-lo o CLI procuraria os arquivos na
    // raiz do monorepo em vez da pasta deste teste.
    env: { ...process.env, INIT_CWD: cwd, BRABO_ACCOUNT_TOKEN: '', ...env },
    // Rede de segurança: os dois caminhos exercitados aqui saem em
    // milissegundos. Um processo que ficasse de pé seria um teste travado,
    // não um teste lento.
    timeout: 30_000,
  });
  return {
    stdout: resultado.stdout ?? '',
    stderr: resultado.stderr ?? '',
    status: resultado.status,
  };
}

describe('brabo-runner sem credencial: a saída DIZ o que houve (RN-475)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(homedir(), '.brabo-runner-spec-'));
    // Config local válida nos dois casos: o que muda entre eles é SÓ a chave.
    // É a metade que confundia — o `uso()` falava de `--project`, que estava
    // resolvido o tempo todo.
    writeFileSync(
      join(dir, NOME_ARQUIVO_CONFIG),
      JSON.stringify({ projectId: 'proj-1', apiUrl: 'http://localhost:3000' }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('SEM arquivo de chave: o bloco de uso, que é a resposta certa para quem não configurou nada', () => {
    const { stderr, status } = rodarNaPasta(dir);

    expect(status).toBe(2);
    expect(stderr).toContain('uso: brabo-runner');
    expect(stderr).not.toContain('RECUSADO');
  });

  it('COM arquivo de chave sem `kid`: a recusa nomeada, e NÃO o bloco de uso', () => {
    writeFileSync(
      join(dir, NOME_ARQUIVO_CHAVE),
      JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'abc', d: 'def' }),
    );

    const { stderr, status } = rodarNaPasta(dir);

    expect(status).toBe(2);
    expect(stderr).toContain(NOME_ARQUIVO_CHAVE);
    expect(stderr).toContain('RECUSADO');
    expect(stderr).toContain('kid');
    // O bloco de uso fala de flags. Imprimi-lo aqui é o que mandou a
    // investigação para o lado errado do problema.
    expect(stderr).not.toContain('uso: brabo-runner');
  });

  it('as DUAS saídas são diferentes — o defeito era elas serem idênticas', () => {
    const semArquivo = rodarNaPasta(dir).stderr;
    writeFileSync(
      join(dir, NOME_ARQUIVO_CHAVE),
      JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'abc', d: 'def' }),
    );
    const semKid = rodarNaPasta(dir).stderr;

    expect(semArquivo).not.toBe(semKid);
  });
});

/**
 * O segundo defeito de JUNÇÃO deste arquivo, e o mesmo raciocínio do primeiro
 * (RN-475): `service` é despachado ANTES de `lerArgumentos`, e nenhum teste de
 * unidade de `servico.ts` prova isso — ele passaria idêntico com o despacho no
 * lugar errado, e aí `service status` numa pasta sem credencial imprimiria o
 * bloco de uso em vez da resposta. Processo de verdade, `cwd` de verdade,
 * pasta SEM chave nenhuma (RN-518).
 */
describe('brabo-runner service é despachado antes de exigir credencial (RN-518)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(homedir(), '.brabo-runner-servico-spec-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('`service status --project <id>` responde NÃO INSTALADO (4), nunca o bloco de uso', () => {
    const { stdout, stderr, status } = rodarNaPasta(dir, [
      'service',
      'status',
      '--project',
      'proj-de-teste',
    ]);

    expect(status).toBe(4);
    expect(stdout).toContain('NÃO INSTALADO');
    expect(stderr).not.toContain('uso: brabo-runner');
  });

  it('subcomando desconhecido cai no uso DE SERVICE, não no do CLI inteiro', () => {
    const { stderr, status } = rodarNaPasta(dir, ['service', 'start']);

    expect(status).toBe(2);
    expect(stderr).toContain('uso: brabo-runner service');
    expect(stderr).toContain('ADR 0147');
  });
});

/**
 * O PORTÃO da RN-544, provado no PROCESSO pelo mesmo motivo dos dois defeitos
 * acima: ele vive na JUNÇÃO de `lerArgumentos` com `base.ts` e `device-key.ts`,
 * e nenhum teste de unidade dos três o pega. Até esta RN, `if (!projectId)
 * uso()` — não existia execução sem projeto. Agora existe UMA, e o que este
 * bloco tranca é que ela continua ESTREITA: sem base consentida, rodar sem
 * `--project` segue caindo em `uso()`, como sempre caiu.
 *
 * `XDG_CONFIG_HOME` é apontado para uma pasta controlada nos dois testes — a
 * máquina de quem roda a suíte pode ter um `~/.config/brabo/runner.json` de
 * verdade, e sem isso o primeiro teste passaria ou falharia por acidente.
 */
describe('brabo-runner sem --project: o agente de MÁQUINA exige base (RN-544)', () => {
  let dir: string;
  let xdg: string;

  beforeEach(() => {
    dir = mkdtempSync(join(homedir(), '.brabo-runner-maquina-spec-'));
    xdg = mkdtempSync(join(homedir(), '.brabo-runner-xdg-spec-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(xdg, { recursive: true, force: true });
  });

  it('SEM base consentida: recusa DIZENDO que falta a base, e ainda imprime o uso', () => {
    const { stderr, status } = rodarNaPasta(dir, [], { XDG_CONFIG_HOME: xdg });

    expect(status).toBe(2);
    expect(stderr).toContain('agente de MÁQUINA');
    expect(stderr).toContain('BASE de projetos consentida');
    // O bloco de uso continua saindo: quem digitou errado o `--project` precisa
    // dele, e esta recusa não substitui a resposta de sempre.
    expect(stderr).toContain('uso: brabo-runner');
  });

  it('COM base consentida, a recusa passa a ser da CREDENCIAL — o portão abriu', () => {
    mkdirSync(join(xdg, 'brabo'), { recursive: true });
    const base = join(homedir(), '.brabo-runner-base-spec');
    writeFileSync(join(xdg, 'brabo', 'runner.json'), JSON.stringify({ base }));
    // Chave PRESENTE e recusada (sem `kid`) — é ela que prova que a execução
    // atravessou a base e chegou na credencial, e a mensagem continua sendo a
    // própria da RN-475, nunca o bloco de uso.
    writeFileSync(
      join(dir, NOME_ARQUIVO_CHAVE),
      JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'abc', d: 'def' }),
    );

    const { stderr, status } = rodarNaPasta(dir, [], { XDG_CONFIG_HOME: xdg });

    expect(status).toBe(2);
    expect(stderr).toContain('RECUSADO');
    expect(stderr).toContain('kid');
    expect(stderr).not.toContain('BASE de projetos consentida');
  });
});
