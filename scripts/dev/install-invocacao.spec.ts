import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// COMO o instalador é rodado (AT-083). A forma que o runbook documentava,
// `sh -c "$(curl … install.sh)"`, nunca funcionou: o instalador confere o
// PRÓPRIO hash contra o manifesto assinado (RN-526), e em `X -c "…"` o `$0` é o
// nome do shell, não um arquivo. Com `dash` como `sh` ele morria antes ainda,
// no `set -o pipefail`. A decisão do mantenedor (18/09) foi documentar BAIXAR e
// rodar um arquivo — `curl -fsSLO … && bash install.sh` —, manter a
// autoverificação por `$0` e NÃO abrir porta de pular (ADR 0150).
//
// O que estes testes cobram é que cada forma ERRADA seja uma recusa NOMEADA que
// ensina a certa, e nunca a morte muda nem a acusação de adulteração — e que a
// forma certa seja UMA só, nos lugares que a ensinam. Nada aqui baixa coisa
// alguma: todas as recusas acontecem antes do primeiro download.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ, 'install.sh');
const fonte = () => fs.readFileSync(SCRIPT, 'utf8');

const FORMA_CERTA =
  'curl -fsSLO https://github.com/daneiel/brabo/releases/latest/download/install.sh && bash install.sh';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-install-invocacao-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function rodar(
  comando: string,
  args: string[],
  opcoes: { entrada?: string } = {},
): { codigo: number; stdout: string; stderr: string } {
  const r = spawnSync(comando, args, {
    cwd: tmp,
    input: opcoes.entrada ?? '',
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 20_000,
  });
  return { codigo: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A recusa de quem roda SEM arquivo — e o que ela nunca pode ser. */
function esperarRecusaSemArquivo(r: { codigo: number; stdout: string; stderr: string }): void {
  expect(r.codigo).toBe(1);
  expect(r.stderr).toContain('precisa rodar de um ARQUIVO');
  expect(r.stderr).toContain(FORMA_CERTA);
  // Antes do primeiro download — o que prova que a recusa veio da INVOCAÇÃO, e
  // não de um passo adiante que por acaso falhou.
  expect(r.stdout).not.toContain('Verificando a origem');
  // A frase de INCIDENTE não pode aparecer: não houve hash para comparar.
  expect(r.stderr).not.toContain('não está no manifesto');
}

const bashAbsoluto = ['/bin/bash', '/usr/bin/bash'].find((c) => fs.existsSync(c));
const dash = ['/bin/dash', '/usr/bin/dash'].find((c) => fs.existsSync(c));

describe('as formas erradas de rodar são recusadas COM NOME, antes de baixar qualquer coisa', () => {
  it('`bash -c "$(curl …)"` — o `$0` é "bash", não um arquivo', () => {
    esperarRecusaSemArquivo(rodar('bash', ['-c', fonte()]));
  });

  it('`/bin/bash -c "$(curl …)"` — o `$0` É um arquivo legível, e mesmo assim não é o instalador', (ctx) => {
    // O caso que um `[ -f "$0" ]` sozinho deixaria passar: o hash de
    // `/bin/bash` iria ao manifesto, e a pessoa leria a frase de adulteração.
    if (!bashAbsoluto) ctx.skip('sem bash em /bin nem /usr/bin nesta máquina');
    esperarRecusaSemArquivo(rodar(bashAbsoluto!, ['-c', fonte()]));
  });

  it('`curl … | bash` — o script chega pelo stdin', () => {
    esperarRecusaSemArquivo(rodar('bash', [], { entrada: fonte() }));
  });

  it('`sh -c "$(curl …)"` com dash — a recusa POSIX do topo, e não o "Illegal option" do pipefail', (ctx) => {
    if (!dash) ctx.skip('sem dash nesta máquina — o `sh` do Debian/Ubuntu é o caso que isto mede');
    const r = rodar(dash!, ['-c', fonte()]);
    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('script de bash');
    expect(r.stderr).toContain(FORMA_CERTA);
    expect(r.stderr).not.toMatch(/Illegal option|pipefail/);
  });

  it('`sh install.sh` com dash — o mesmo, com arquivo', (ctx) => {
    if (!dash) ctx.skip('sem dash nesta máquina');
    const r = rodar(dash!, [SCRIPT]);
    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('script de bash');
    expect(r.stderr).not.toMatch(/Illegal option/);
  });

  it('os modos de impressão continuam funcionando por `bash install.sh` — o arquivo existe', () => {
    const r = rodar('bash', [SCRIPT, '--print-plan']);
    expect(r.codigo, r.stderr).toBe(0);
    expect(r.stdout).toContain('apagar-base-de-projetos');
  });
});

describe('a ferramenta de hash que não consegue ler o arquivo falha NOMEADA (AT-083)', () => {
  /** O script sem a chamada de `main`, carregável por `source`. */
  function carregavel(): string {
    const corpo = fonte().replace(/\nmain\s+"\$@"\s*$/, '\n');
    const caminho = path.join(tmp, 'install-sem-main.sh');
    fs.writeFileSync(caminho, corpo);
    return caminho;
  }

  it('`hash_sha256` de um arquivo ausente recusa dizendo o quê — e o chamador para ali', () => {
    const r = rodar('bash', [
      '-c',
      `source "${carregavel()}"
       exigir_ferramenta_de_hash
       x="$(hash_sha256 /nao/existe/install.sh)"
       echo "SEGUIU:[$x]"`,
    ]);
    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('não consegui calcular o sha256');
    expect(r.stderr).toContain('/nao/existe/install.sh');
    expect(r.stdout).not.toContain('SEGUIU');
  });

  it('`conferir_hash` de um arquivo ausente NÃO diz o motivo de incidente do chamador', () => {
    // Sem a recusa nomeada, `hash_sha256` devolvia VAZIO dentro da substituição
    // (errexit não chega ao subshell) e a comparação falhava com a frase de
    // incidente — a acusação de adulteração da AT-091, por outro caminho.
    const r = rodar('bash', [
      '-c',
      `source "${carregavel()}"
       exigir_ferramenta_de_hash
       conferir_hash /nao/existe abc 'MOTIVO-DE-INCIDENTE: pare e investigue'`,
    ]);
    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('não consegui calcular o sha256');
    expect(r.stderr).not.toContain('MOTIVO-DE-INCIDENTE');
  });
});

describe('a forma certa é UMA só, nos lugares que a ensinam', () => {
  it('o cabeçalho do install.sh ensina baixar e rodar com bash', () => {
    const uso = fonte().split('\n').slice(0, 10).join('\n');
    expect(uso).toContain(`#   ${FORMA_CERTA}`);
  });

  it('a constante que as recusas e o relato sem TTY usam é a MESMA do cabeçalho', () => {
    const corpo = fonte().replace(/\nmain\s+"\$@"\s*$/, '\n');
    const caminho = path.join(tmp, 'install-constante.sh');
    fs.writeFileSync(caminho, corpo);
    const r = rodar('bash', ['-c', `source "${caminho}"; printf '%s' "$COMO_RODAR"`]);
    expect(r.stdout).toBe(FORMA_CERTA);
  });

  it('o relato sem TTY ensina pela constante, e não por uma cópia da frase', () => {
    const texto = fonte();
    const i = texto.indexOf("dizer 'Sem terminal interativo");
    expect(i).toBeGreaterThan(0);
    const trecho = texto.slice(i, i + 300);
    expect(trecho).toContain('${COMO_RODAR}');
  });

  it('o runbook e o bootstrap ensinam a forma certa, e nenhum dos dois a antiga', () => {
    const runbook = fs.readFileSync(path.join(RAIZ, 'docs/runbook.md'), 'utf8');
    expect(runbook).toContain(FORMA_CERTA);
    const bootstrap = fs.readFileSync(path.join(RAIZ, 'scripts/dev/bootstrap.sh'), 'utf8');
    expect(bootstrap).toContain(FORMA_CERTA);

    // A forma antiga só pode sobreviver como HISTÓRIA — explicada, nunca
    // ensinada. Nos três arquivos que alguém copia para o terminal, nenhuma
    // linha a manda rodar.
    const antiga = /sh -c "\$\(curl -fsSL [^"]*install\.sh\)"/;
    for (const [nome, texto] of [
      ['docs/runbook.md', runbook],
      ['scripts/dev/bootstrap.sh', bootstrap],
      ['README.md', fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8')],
    ] as const) {
      expect(texto, nome).not.toMatch(antiga);
    }
    // No install.sh ela aparece só abreviada, no comentário que conta por que
    // saiu — nunca por extenso, que é a forma copiável.
    expect(fonte()).not.toMatch(antiga);
  });
});
