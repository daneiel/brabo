import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function rodarNaPasta(cwd: string): { stderr: string; status: number | null } {
  const resultado = spawnSync(process.execPath, [CLI], {
    cwd,
    encoding: 'utf-8',
    // `INIT_CWD` vence `process.cwd()` em `lerArgumentos` — o vitest o herda
    // do pnpm que o invocou, e sem limpá-lo o CLI procuraria os arquivos na
    // raiz do monorepo em vez da pasta deste teste.
    env: { ...process.env, INIT_CWD: cwd, BRABO_ACCOUNT_TOKEN: '' },
    // Rede de segurança: os dois caminhos exercitados aqui saem em
    // milissegundos. Um processo que ficasse de pé seria um teste travado,
    // não um teste lento.
    timeout: 30_000,
  });
  return { stderr: resultado.stderr ?? '', status: resultado.status };
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
