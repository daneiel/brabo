import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `produtor | grep -q x` sob `pipefail` (AT-242, a família da AT-241).
 *
 * `grep -q` sai na primeira linha que casa e fecha o pipe; o produtor que ainda
 * escreve morre de EPIPE/SIGPIPE e, com `pipefail`, a pipeline inteira falha —
 * sobre um resultado VERDADEIRO. Só acontece quando o produtor escreve em mais
 * de um pedaço depois da linha que casa (medido: `k3d cluster list` 9 escritas
 * só no cabeçalho, `kind get clusters` 5, `gh --jq` 3, `journalctl` 13 para 300
 * linhas), e por isso aparecia sob carga, nunca na mesa.
 *
 * O conserto, no molde do #712: ler a saída INTEIRA numa variável e só depois
 * `grep -q … <<<"$var"`, com desfecho próprio quando o produtor falha de
 * verdade. Aqui cada trecho consertado é EXTRAÍDO do arquivo real e rodado num
 * bash de verdade contra um produtor falso que FORÇA a corrida: escreve a linha
 * que casa, espera o `grep` sair, e escreve mais. O bloco "controle" prova que
 * o produtor falso reproduz o defeito na forma antiga — sem ele, um verde aqui
 * não diria nada.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let area: string;
let bin: string;

beforeEach(() => {
  area = mkdtempSync(path.join(tmpdir(), 'brabo-epipe-'));
  bin = path.join(area, 'bin');
  mkdirSync(bin);
});

afterEach(() => {
  rmSync(area, { recursive: true, force: true });
});

/**
 * As linhas de `arquivo` da n-ésima que contém `inicio` até a primeira seguinte
 * que satisfaz `fim`, sem a indentação da primeira. Âncora que some reprova —
 * o spec nunca passa por não achar o que devia provar.
 */
function trecho(arquivo: string, inicio: string, fim: RegExp, ocorrencia = 1): string {
  const linhas = readFileSync(path.join(RAIZ, arquivo), 'utf8').split('\n');
  let achadas = 0;
  const i = linhas.findIndex((l) => l.includes(inicio) && ++achadas === ocorrencia);
  if (i < 0) throw new Error(`${arquivo}: âncora "${inicio}" (ocorrência ${ocorrencia}) não encontrada`);
  const f = linhas.findIndex((l, j) => j > i && fim.test(l));
  if (f < 0) throw new Error(`${arquivo}: fim ${fim} não encontrado depois de "${inicio}"`);
  const recuo = /^\s*/.exec(linhas[i] ?? '')![0].length;
  return linhas
    .slice(i, f + 1)
    .map((l) => l.slice(Math.min(recuo, /^\s*/.exec(l)![0].length)))
    .join('\n');
}

/** Um executável falso no PATH. */
function falso(nome: string, corpo: string) {
  writeFileSync(path.join(bin, nome), `#!/usr/bin/env bash\n${corpo}\n`);
  chmodSync(path.join(bin, nome), 0o755);
}

/** Escreve `casa`, espera o `grep -q` sair, e escreve mais — a corrida forçada. */
function corrida(casa: string): string {
  return `printf '%s\\n' ${JSON.stringify(casa)}
    sleep 0.3
    for n in $(seq 1 50); do printf 'linha-depois-%s\\n' "$n"; done
    exit 0`;
}

function rodar(script: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['-c', `set -euo pipefail\n${script}`], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C.UTF-8', PATH: `${bin}:${process.env.PATH ?? ''}`, ...env },
    timeout: 30_000,
  });
  return { codigo: r.status, saida: r.stdout, erro: r.stderr, tudo: `--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}` };
}

const STUBS = `
info() { echo "info $*"; }
ok()   { echo "ok $*"; }
warn() { echo "warn $*" >&2; }
die()  { echo "DIE $*" >&2; exit 1; }
fail() { echo "FAIL $*" >&2; exit 1; }
`;

describe('controle: o produtor falso reproduz o defeito na forma ANTIGA', () => {
  it.each([
    ['k3d', 'k3d cluster list', "grep -q '^brabo\\b'", 'brabo   1/1   0/0   true'],
    ['kind', 'kind get clusters', 'grep -qx brabo', 'brabo'],
    ['kubectl', 'kubectl logs job/x', "grep -qF 'faltando: git_local_repos'", 'faltando: git_local_repos'],
    ['gh', 'gh release view v1 --json assets', 'grep -qx brabo-runner-linux-x64', 'brabo-runner-linux-x64'],
    ['journalctl', 'journalctl --user -u u --no-pager', "grep -qF 'FICA DE PÉ'", 'o agente FICA DE PÉ'],
  ])('%s | grep -q reprova sob pipefail sobre um resultado verdadeiro', (nome, produtor, filtro, casa) => {
    falso(nome, corrida(casa));
    const r = rodar(`${produtor} | ${filtro}`);
    expect(r.codigo, r.tudo).not.toBe(0);
  });
});

describe('deploy/k8s/bootstrap.sh — o cluster que existe não parece ausente', () => {
  const k3d = () => trecho('deploy/k8s/bootstrap.sh', 'create_cluster_k3d() {', /^}$/);
  const kind = () => trecho('deploy/k8s/bootstrap.sh', 'create_cluster_kind() {', /^}$/);

  it('k3d: reaproveita o cluster mesmo com a lista ainda sendo escrita', () => {
    falso('k3d', `if [[ "$1 $2" == "cluster list" ]]; then\n${corrida('brabo   1/1   0/0   true')}\nfi\necho "k3d $*" >> "${area}/chamadas"`);
    const r = rodar(`${STUBS}\n${k3d()}\ncreate_cluster_k3d`, { CLUSTER_NAME: 'brabo', BRABO_KEEP_CLUSTER: '1' });
    expect(r.codigo, r.tudo).toBe(0);
    expect(r.saida).toContain('reaproveitado');
  });

  it('k3d que falha ao listar continua lido como "sem cluster"', () => {
    falso('k3d', `if [[ "$1 $2" == "cluster list" ]]; then exit 3; fi\necho "k3d $*" >> "${area}/chamadas"`);
    const r = rodar(`${STUBS}\n${k3d()}\ncreate_cluster_k3d`, { CLUSTER_NAME: 'brabo', BRABO_KEEP_CLUSTER: '1' });
    expect(r.codigo, r.tudo).toBe(0);
    expect(readFileSync(path.join(area, 'chamadas'), 'utf8')).toContain('k3d cluster create brabo');
  });

  it('kind: reaproveita o cluster mesmo com a lista ainda sendo escrita', () => {
    falso('kind', `if [[ "$1 $2" == "get clusters" ]]; then\n${corrida('brabo')}\nfi\necho "kind $*" >> "${area}/chamadas"`);
    const r = rodar(`${STUBS}\n${kind()}\ncreate_cluster_kind`, { CLUSTER_NAME: 'brabo', BRABO_KEEP_CLUSTER: '1' });
    expect(r.codigo, r.tudo).toBe(0);
    expect(r.saida).toContain('reaproveitado');
  });
});

describe('deploy/k8s/test-restore.sh — a mutação PEGA não vira "outro motivo"', () => {
  const bloco = () =>
    trecho('deploy/k8s/test-restore.sh', 'log_do_restore="$(kubectl', /^\s*fi$/);
  const env = { NS: 'brabo', JOB_RESTORE: 'restore-x', TABELA_MUTACAO: 'git_local_repos' };

  it('lê o log inteiro e reconhece a tabela nomeada', () => {
    falso('kubectl', corrida('[restore] faltando: git_local_repos'));
    const r = rodar(`${STUBS}\n${bloco()}\necho 'NAO RECONHECEU'; exit 9`, env);
    expect(r.codigo, r.tudo).toBe(0);
    expect(r.saida).toContain('mutação PEGA');
  });

  it('kubectl que não lê o log tem desfecho próprio', () => {
    falso('kubectl', 'echo "erro de mentira do kubectl" >&2; exit 1');
    const r = rodar(`${STUBS}\n${bloco()}\necho 'NAO RECONHECEU'; exit 9`, env);
    expect(r.codigo, r.tudo).toBe(1);
    expect(r.erro).toContain('erro de mentira do kubectl');
    expect(r.erro).toContain('não pôde ser lido');
  });
});

describe('deploy/k8s/smoke.sh — o /metrics grande não reprova', () => {
  it('passa com um /metrics bem maior que a capacidade do pipe (64 KiB)', () => {
    const bloco = trecho('deploy/k8s/smoke.sh', `grep -q 'oban_queue_depth' <<<"\${metrics}"`, /^ok "oban_queue_depth/);
    const linhas = ['oban_queue_depth{queue="default",state="available"} 0'];
    for (let n = 0; n < 6000; n++) linhas.push(`beam_metrica_qualquer{n="${n}"} ${n}`);
    const metricas = path.join(area, 'metrics');
    writeFileSync(metricas, linhas.join('\n'));
    const r = rodar(`${STUBS}\nmetrics="$(cat '${metricas}')"\n${bloco}`);
    expect(r.codigo, r.tudo).toBe(0);
    expect(r.saida).toContain('oban_queue_depth com os rótulos');
  });
});

describe('.github/workflows/build-runner-binaries.yml — o asset já anexado não é reenviado', () => {
  const bloco = () =>
    trecho(
      '.github/workflows/build-runner-binaries.yml',
      'anexados="$(gh release view "$TAG" --json assets --jq ".assets[].name")"',
      /^\s*fi$/,
    );
  const env = { TAG: 'v9.9.9', nome: 'brabo-runner-linux-x64', arquivo: '/dev/null' };

  it('reconhece o asset mesmo com a lista ainda sendo escrita', () => {
    falso('gh', `if [[ "$1 $2" == "release view" ]]; then\n${corrida('brabo-runner-linux-x64')}\nfi\necho "gh $*" >> "${area}/chamadas"`);
    const r = rodar(bloco(), env);
    expect(r.codigo, r.tudo).toBe(0);
    expect(r.saida).toContain('já está anexado');
    expect(r.saida).not.toContain('anexado: ');
  });

  it('gh que não lista os assets reprova nomeado, em vez de enviar às cegas', () => {
    falso('gh', `if [[ "$1 $2" == "release view" ]]; then echo 'erro de mentira do gh' >&2; exit 1; fi\necho "gh $*" >> "${area}/chamadas"`);
    const r = rodar(bloco(), env);
    expect(r.codigo, r.tudo).toBe(1);
    expect(r.saida).toContain('não foi possível listar os assets');
    expect(() => readFileSync(path.join(area, 'chamadas'), 'utf8')).toThrow();
  });
});

describe('.github/workflows/install-e2e.yml — a linha que já está no journal é vista', () => {
  it.each([
    [1, 'FICA DE PÉ'],
    [2, 'a espera ACABA'],
  ])('ja_disse (passo %i) casa com o journal ainda sendo escrito', (ocorrencia, frase) => {
    const funcao = trecho('.github/workflows/install-e2e.yml', 'ja_disse() {', /^\s*}$/, ocorrencia);
    falso('journalctl', corrida(`brabo-runner[1]: ${frase}`));
    const r = rodar(`${funcao}\nja_disse brabo-runner.service '${frase}' && echo VISTA`);
    expect(r.codigo, r.tudo).toBe(0);
    expect(r.saida).toContain('VISTA');
  });

  it('journalctl que falha é "ainda não", nunca "vista"', () => {
    const funcao = trecho('.github/workflows/install-e2e.yml', 'ja_disse() {', /^\s*}$/);
    falso('journalctl', 'exit 1');
    const r = rodar(`${funcao}\nif ja_disse u 'FICA DE PÉ'; then echo VISTA; else echo AINDA-NAO; fi`);
    expect(r.codigo, r.tudo).toBe(0);
    expect(r.saida).toContain('AINDA-NAO');
  });
});
