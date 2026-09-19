import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// A pergunta do broker de container no `install.sh` (ADR 0162). O que ligar
// concede é o socket do Docker desta máquina a um serviço da instalação, e por
// isso a pergunta tem três regras que estes testes fixam, cada uma com a sua
// mutação: só um "s" digitado liga (Enter, "n" e a falta de terminal deixam
// desligado — e DIZEM isso); ligar exige o gid MEDIDO de dentro de um
// container, e não medir é RECUSA nomeada, nunca um palpite; e nada disso toca
// o Docker enquanto a resposta não for sim.
//
// As funções rodam DE VERDADE (o molde de `install-fechamento.spec.ts`: o
// script carregado por `source`, menos a chamada de `main`), e o `docker` é um
// dublê no PATH que REGISTRA cada chamada — é por esse registro que "não tocou
// o Docker" é asserido, em vez de inferido da saída.
//
// A metade com terminal roda sob um pty de verdade (Python, o mesmo mecanismo
// do driver do `install-e2e.yml`): a pergunta está atrás de `[ -t 0 ]`, e um
// pipe no stdin nunca a alcançaria.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ, 'install.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-install-broker-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function carregavel(): string {
  const texto = fs.readFileSync(SCRIPT, 'utf8');
  const corpo = texto.replace(/\nmain\s+"\$@"\s*$/, '\n');
  if (corpo === texto) throw new Error('não achei a chamada de main para recortar de install.sh');
  const caminho = path.join(tmp, 'install-sem-main.sh');
  fs.writeFileSync(caminho, corpo);
  return caminho;
}

/**
 * Um `docker` de mentira. Toda chamada é anotada em `registro`, uma por linha;
 * `docker run …` responde `saidaDoRun` (ou falha com `falhaDoRun`), e
 * `docker info` responde `raizDoDocker`.
 */
function dockerFalso(opcoes: {
  saidaDoRun?: string;
  falhaDoRun?: string;
  raizDoDocker?: string;
}): { dir: string; registro: string } {
  const dir = fs.mkdtempSync(path.join(tmp, 'bin-'));
  const registro = path.join(dir, 'chamadas.log');
  const run = opcoes.falhaDoRun
    ? `printf '%s\\n' '${opcoes.falhaDoRun}' >&2; exit 125`
    : `printf '%s\\n' '${opcoes.saidaDoRun ?? 'socket 984'}'`;
  fs.writeFileSync(
    path.join(dir, 'docker'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> '${registro}'
case "$1" in
  run) ${run} ;;
  info) printf '%s\\n' '${opcoes.raizDoDocker ?? '/var/lib/docker'}' ;;
  *) exit 0 ;;
esac
`,
  );
  fs.chmodSync(path.join(dir, 'docker'), 0o755);
  return { dir, registro };
}

const chamadas = (registro: string): string[] =>
  fs.existsSync(registro) ? fs.readFileSync(registro, 'utf8').split('\n').filter(Boolean) : [];

/** O que roda depois da pergunta: o estado que ela deixou, em linhas legíveis. */
const DEPOIS = `consentir_broker
printf 'ESTADO ligado=%s gid=%s raiz=%s\\n' "$BROKER_LIGADO" "$DOCKER_GID_MEDIDO" "$RAIZ_GERENCIADA_NO_HOST"
printf 'PENDENCIAS=[%s]\\n' "$PENDENCIAS"`;

const IMAGEM = 'ghcr.io/daneiel/brabo-broker@sha256:' + 'e'.repeat(64);

/** Sem terminal: stdin é um pipe. */
function semTerminal(bin: string): { saida: string; codigo: number } {
  const r = spawnSync('bash', ['-c', `source "${carregavel()}"\nBRABO_BROKER_IMAGE='${IMAGEM}'\n${DEPOIS}`], {
    encoding: 'utf8',
    input: 's\n',
    env: { ...process.env, NO_COLOR: '1', PATH: `${bin}:${process.env.PATH ?? ''}` },
  });
  return { saida: `${r.stdout}${r.stderr}`, codigo: r.status ?? -1 };
}

const python = spawnSync('python3', ['--version']).status === 0;

/**
 * Com terminal: a função roda sob um pty, e a resposta só é escrita DEPOIS de a
 * pergunta aparecer — como uma pessoa no teclado.
 */
function comTerminal(bin: string, resposta: string): { saida: string; codigo: number } {
  const driver = path.join(tmp, 'pty.py');
  fs.writeFileSync(
    driver,
    `import os, pty, select, sys, time
alvo = b"Ligar o broker de container? [s/N] "
pid, mestre = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
lido = bytearray(); respondeu = False; limite = time.monotonic() + 20
while True:
    pronto, _, _ = select.select([mestre], [], [], 0.2)
    if pronto:
        try:
            pedaco = os.read(mestre, 65536)
        except OSError:
            pedaco = b""
        if not pedaco:
            break
        lido.extend(pedaco)
    if not respondeu and alvo in lido:
        os.write(mestre, (os.environ["RESPOSTA"] + "\\n").encode())
        respondeu = True
    if time.monotonic() > limite:
        break
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(bytes(lido))
sys.exit(os.waitstatus_to_exitcode(status))
`,
  );
  const r = spawnSync(
    'python3',
    ['-I', driver, 'bash', '-c', `source "${carregavel()}"\nBRABO_BROKER_IMAGE='${IMAGEM}'\n${DEPOIS}`],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: '1', RESPOSTA: resposta, PATH: `${bin}:${process.env.PATH ?? ''}` },
    },
  );
  return { saida: r.stdout ?? '', codigo: r.status ?? -1 };
}

describe('install.sh — o plano declara a pergunta do broker', () => {
  it('pergunta, e nunca liga sem perguntar', () => {
    const plano = spawnSync('bash', [SCRIPT, '--print-plan'], { encoding: 'utf8' }).stdout;
    expect(plano).toMatch(/^ligar-broker\tpergunta\t.*default NÃO/m);
    expect(plano).toMatch(/^ligar-broker-sem-perguntar\tnunca\t/m);
  });

  it('o risco é dito em TEXTO antes da pergunta — o socket, e quem o comanda', () => {
    const texto = fs.readFileSync(SCRIPT, 'utf8');
    const inicio = texto.indexOf('consentir_broker() {');
    const pergunta = texto.indexOf("printf 'Ligar o broker de container? [s/N] '", inicio);
    expect(inicio).toBeGreaterThan(0);
    expect(pergunta).toBeGreaterThan(inicio);
    const antes = texto.slice(inicio, pergunta);
    expect(antes).toContain('recebe o socket do Docker DESTA máquina');
    expect(antes).toContain('Quem comanda o broker comanda o');
    expect(antes).toContain('o modo Runner usa');
  });
});

describe('install.sh — sem terminal, o broker fica desligado e o script DIZ', () => {
  it('não liga, diz que ficou desligado, e não toca o Docker', () => {
    const { dir, registro } = dockerFalso({});
    const r = semTerminal(dir);
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain('Não há terminal para perguntar: o broker fica DESLIGADO.');
    expect(r.saida).toContain('ESTADO ligado=nao gid= raiz=');
    expect(chamadas(registro)).toEqual([]);
  });
});

describe('install.sh — com terminal, só "s" liga', () => {
  it('Enter (o default) deixa desligado, e não toca o Docker', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina — o pty do teste é o mesmo mecanismo do E2E');
    const { dir, registro } = dockerFalso({});
    const r = comTerminal(dir, '');
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain('broker de container: desligado');
    expect(r.saida).toContain('ESTADO ligado=nao gid= raiz=');
    expect(chamadas(registro)).toEqual([]);
  });

  it('"n" deixa desligado', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina');
    const { dir, registro } = dockerFalso({});
    const r = comTerminal(dir, 'n');
    expect(r.saida).toContain('ESTADO ligado=nao');
    expect(chamadas(registro)).toEqual([]);
  });

  it('"s" liga — o gid sai da medição de DENTRO de um container, com a imagem do broker', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina');
    const { dir, registro } = dockerFalso({ saidaDoRun: 'socket 984' });
    const r = comTerminal(dir, 's');
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain('grupo do socket, visto de dentro de um container: 984');
    expect(r.saida).toContain(
      'ESTADO ligado=sim gid=984 raiz=/var/lib/docker/volumes/brabo_project_workspaces/_data',
    );
    expect(r.saida).toContain('PENDENCIAS=[]');

    const run = chamadas(registro).find((c) => c.startsWith('run '));
    expect(run).toBeDefined();
    // `--mount type=bind` (recusa origem inexistente) e não `-v` (criaria a
    // pasta no host); sem rede; a imagem do broker, nenhuma de terceiro.
    expect(run).toContain('--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock');
    expect(run).not.toMatch(/(^| )-v /);
    expect(run).toContain('--network none');
    expect(run).toContain(IMAGEM);
  });

  it('a medição que FALHA é recusa nomeada, e o broker não liga (nunca um 999 no lugar)', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina');
    const { dir } = dockerFalso({
      falhaDoRun: 'invalid mount config for type "bind": bind source path does not exist: /var/run/docker.sock',
    });
    const r = comTerminal(dir, 's');
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain('não consegui medir o grupo do socket do Docker');
    expect(r.saida).toContain('bind source path does not exist');
    expect(r.saida).toContain('responda NÃO');
    expect(r.saida).not.toContain('ESTADO ligado=sim');
  });

  it('um caminho que não é socket é recusa nomeada', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina');
    const { dir } = dockerFalso({ saidaDoRun: 'directory 0' });
    const r = comTerminal(dir, 's');
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain('não é um socket (é: directory)');
  });

  it('um gid que não é número é recusa nomeada', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina');
    const { dir } = dockerFalso({ saidaDoRun: 'socket docker' });
    const r = comTerminal(dir, 's');
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("o gid lido não é um número: 'docker'");
  });

  it('sem saber onde o Docker guarda volumes, liga e deixa a raiz como PENDÊNCIA nomeada', (ctx) => {
    if (!python) ctx.skip('sem python3 nesta máquina');
    const { dir } = dockerFalso({ saidaDoRun: 'socket 984', raizDoDocker: '' });
    const r = comTerminal(dir, 's');
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain('ESTADO ligado=sim gid=984 raiz=');
    expect(r.saida).toContain('PROJECT_WORKSPACES_HOST_ROOT');
  });
});

describe('install.sh — a frase final não promete o que a instalação não faz', () => {
  it('sem broker, NENHUM dos dois modos do broker sobe container — não só a Pasta montada', () => {
    const texto = fs.readFileSync(SCRIPT, 'utf8');
    expect(texto).not.toContain('em modo Pasta montada não sobe container (ADR 0144); o modo Runner');
    expect(texto).toContain("dizer 'Docker desta máquina. Sem broker, projeto em modo Container ou Pasta'");
    // E a decisão aparece no resumo final, nos dois sentidos.
    expect(texto).toContain('Broker de container: LIGADO');
    expect(texto).toContain('Broker de container: DESLIGADO');
  });
});
