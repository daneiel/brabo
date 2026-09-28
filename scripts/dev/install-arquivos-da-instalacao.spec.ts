import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Os arquivos que SOBEM a instalação (RN-570, ADR 0160): o compose de
// instalação e o que ele monta. Até aqui o `install.sh` subia a pilha com um
// caminho relativo ao diretório de onde rodava, apontando para arquivos que
// nada trazia — numa pasta vazia a subida morria DEPOIS de o `.env` com os
// segredos estar gravado (RN-549). Agora eles são assets da Release, entram no
// `checksums.txt` assinado, e o script os baixa e confere antes de perguntar ou
// gravar qualquer coisa.
//
// No molde de `install-fechamento.spec.ts`: o script inteiro carregado com
// `source` (menos a chamada de `main`), as funções invocadas de verdade, e a
// Release servida por um `node:http` em porta efêmera. O `checksums.txt` aqui
// NÃO é assinado — a assinatura é conferida por `verificar_a_si_mesmo`, antes,
// com `cosign`, e só uma tag final a exercita (`install-e2e.yml`). O que se
// prova aqui é a metade que vem depois: dado um manifesto já verificado, o
// script usa as cópias que batem com ele, e RECUSA nomeando quando um asset
// falta, não é coberto ou não bate — sempre antes de gravar o `.env`.

const RAIZ_DO_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ_DO_REPO, 'install.sh');
const fonte = () => fs.readFileSync(SCRIPT, 'utf8');

const ASSETS = {
  'brabo-install-compose.yml': 'name: brabo\nservices: {}\n',
  'brabo-install-postgres-init.sql': 'CREATE EXTENSION IF NOT EXISTS vector;\n',
  'brabo-install-ollama-pull-models.sh': '#!/bin/sh\necho puxando\n',
  'brabo-install-backup-test-restore.sh': '#!/usr/bin/env bash\necho provando\n',
} as const;
type NomeDoAsset = keyof typeof ASSETS;

const DESTINOS: Record<NomeDoAsset, string> = {
  'brabo-install-compose.yml': 'docker/docker-compose.install.yml',
  'brabo-install-postgres-init.sql': 'docker/postgres/init.sql',
  'brabo-install-ollama-pull-models.sh': 'docker/ollama/pull-models.sh',
  'brabo-install-backup-test-restore.sh': 'docker/backup/test-restore-compose.sh',
};

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

/** O manifesto no formato do `sha256sum`, com o `install.sh` e um binário ao lado. */
function manifesto(sobrescrever: Partial<Record<NomeDoAsset, string | null>> = {}): string {
  const linhas = [`${sha256('binario')}  brabo-runner-linux-x64`, `${sha256('instalador')}  install.sh`];
  for (const [nome, conteudo] of Object.entries(ASSETS) as Array<[NomeDoAsset, string]>) {
    const hash = nome in sobrescrever ? sobrescrever[nome] : sha256(conteudo);
    if (hash !== null && hash !== undefined) linhas.push(`${hash}  ${nome}`);
  }
  return `${linhas.join('\n')}\n`;
}

// --- a Release de mentira ---------------------------------------------------

let servidor: Server;
let url = '';
/** O que a Release publica neste teste. Cada caso monta o seu. */
let publicados: Record<string, string> = {};

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const nome = decodeURIComponent((req.url ?? '/').slice(1));
    const corpo = publicados[nome];
    if (corpo === undefined) {
      res.writeHead(404).end('Not Found');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(corpo);
  });
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
});

// --- o script carregado -----------------------------------------------------

const tmpRaiz = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-arquivos-inst-'));
afterAll(() => fs.rmSync(tmpRaiz, { recursive: true, force: true }));

const carregavel = path.join(tmpRaiz, 'install-sem-main.sh');
{
  const texto = fonte();
  const corpo = texto.replace(/\nmain\s+"\$@"\s*$/, '\n');
  if (corpo === texto) throw new Error('não achei a chamada de main para recortar de install.sh');
  fs.writeFileSync(carregavel, corpo);
}

interface Rodada {
  stdout: string;
  stderr: string;
  codigo: number;
}

/**
 * Assíncrona: o servidor roda NESTE processo, e `spawnSync` o travaria.
 *
 * O `stdin` do filho é `/dev/null` (`'ignore'`), e não um pipe fechado com
 * `stdin.end('')` (AT-217). O efeito para o script é o mesmo — EOF na primeira
 * leitura, sem TTY —, mas o pipe tinha uma corrida: com o laço de eventos
 * atrasado pela carga, o filho saía antes de o `end` ser processado, a escrita
 * no pipe sem leitor dava `EPIPE`, e o erro sem handler reprovava a rodada com
 * todos os testes verdes. Sem pipe, não há escrita que possa falhar.
 */
function rodar(comandos: string): Promise<Rodada> {
  return new Promise((resolver) => {
    const processo = spawn('bash', ['-c', `source "${carregavel}"\n${comandos}`], {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    processo.stdout.setEncoding('utf8').on('data', (p: string) => (stdout += p));
    processo.stderr.setEncoding('utf8').on('data', (p: string) => (stderr += p));
    processo.on('close', (codigo) => resolver({ stdout, stderr, codigo: codigo ?? -1 }));
  });
}

let contador = 0;
/** Uma rodada isolada: pasta temporária com o manifesto já "verificado" e a pasta da instalação. */
function cenario(checksums: string): { tmp: string; instalacao: string } {
  contador += 1;
  const base = path.join(tmpRaiz, `caso-${contador}`);
  const tmp = path.join(base, 'verificacao');
  const instalacao = path.join(base, 'instalacao');
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(instalacao, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'checksums.txt'), checksums);
  return { tmp, instalacao };
}

/**
 * O que `main` faz, na ordem que importa: resolver a ferramenta de hash,
 * verificar, e SÓ DEPOIS gravar o `.env` e materializar. Uma recusa na
 * verificação sai 1 ali mesmo — e é por isso que o `.env` não existir depois é
 * a asserção de "antes de gravar".
 *
 * `exigir_ferramenta_de_hash` está aqui porque está no `main`, antes do
 * primeiro download (AT-091): sem ela, `FERRAMENTA_DE_HASH` fica vazia e
 * `hash_sha256` recusa nomeando o defeito como sendo do script. Esta sequência
 * imita o `main`, então imita a ordem dele inteira.
 */
const sequenciaDoMain = (tmp: string, instalacao: string) => `
exigir_ferramenta_de_hash
baixar_e_verificar_os_arquivos_da_instalacao "${url}" "${tmp}"
: > "${instalacao}/.env"
materializar_os_arquivos_da_instalacao "${instalacao}"
printf 'COMPOSE=%s\\nPROVA=%s\\n' "$COMPOSE_DE_INSTALACAO" "$PROVA_DE_RESTAURACAO"
`;

describe('install.sh — os arquivos da instalação vêm da Release, conferidos (RN-570)', () => {
  it('caminho feliz: os quatro batem com o manifesto e as cópias verificadas vão para a pasta da instalação', async () => {
    publicados = { ...ASSETS };
    const { tmp, instalacao } = cenario(manifesto());

    const r = await rodar(sequenciaDoMain(tmp, instalacao));

    expect(r.stderr).toBe('');
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain('arquivos da instalação verificados contra o manifesto assinado');
    expect(r.stdout).toContain(`arquivos da instalação gravados em ${instalacao}/docker`);
    for (const [nome, conteudo] of Object.entries(ASSETS) as Array<[NomeDoAsset, string]>) {
      expect(fs.readFileSync(path.join(instalacao, DESTINOS[nome]), 'utf8')).toBe(conteudo);
    }
    // ABSOLUTOS, e dentro da pasta da instalação — nunca o relativo de antes.
    expect(r.stdout).toContain(`COMPOSE=${instalacao}/docker/docker-compose.install.yml`);
    expect(r.stdout).toContain(`PROVA=${instalacao}/docker/backup/test-restore-compose.sh`);
  });

  it('asset AUSENTE na Release: recusa nomeada, e o `.env` nunca é gravado', async () => {
    const { 'brabo-install-ollama-pull-models.sh': _ausente, ...resto } = ASSETS;
    publicados = { ...resto };
    const { tmp, instalacao } = cenario(manifesto());
    // Um `docker/` que já estivesse na pasta NÃO serve de plano B.
    fs.mkdirSync(path.join(instalacao, 'docker/ollama'), { recursive: true });
    fs.writeFileSync(path.join(instalacao, 'docker/ollama/pull-models.sh'), 'nao-verificado\n');

    const r = await rodar(sequenciaDoMain(tmp, instalacao));

    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('a Release não publica brabo-install-ollama-pull-models.sh');
    expect(r.stderr).toContain('Nada foi gravado');
    expect(fs.existsSync(path.join(instalacao, '.env'))).toBe(false);
    expect(r.stdout).not.toContain('COMPOSE=');
  });

  it('hash que NÃO bate: recusa nomeada, antes do `.env`', async () => {
    publicados = { ...ASSETS, 'brabo-install-compose.yml': 'name: outro\nservices: { mal: {} }\n' };
    const { tmp, instalacao } = cenario(manifesto());

    const r = await rodar(sequenciaDoMain(tmp, instalacao));

    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('brabo-install-compose.yml NÃO bate com o manifesto assinado');
    expect(fs.existsSync(path.join(instalacao, '.env'))).toBe(false);
    expect(fs.existsSync(path.join(instalacao, 'docker'))).toBe(false);
  });

  it('manifesto que não COBRE o asset: recusa, não aviso', async () => {
    publicados = { ...ASSETS };
    const { tmp, instalacao } = cenario(manifesto({ 'brabo-install-postgres-init.sql': null }));

    const r = await rodar(sequenciaDoMain(tmp, instalacao));

    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('o manifesto assinado não cobre brabo-install-postgres-init.sql');
    expect(fs.existsSync(path.join(instalacao, '.env'))).toBe(false);
  });

  it('um nome PARECIDO no manifesto não cobre o asset — a comparação é exata, não padrão', async () => {
    // Com `grep`, o `.` do nome casaria qualquer caractere, e esta linha
    // "cobriria" o compose com o hash certo.
    publicados = { ...ASSETS };
    const checksums = manifesto({ 'brabo-install-compose.yml': null }).concat(
      `${sha256(ASSETS['brabo-install-compose.yml'])}  brabo-install-composeXyml\n`,
    );
    const { tmp, instalacao } = cenario(checksums);

    const r = await rodar(sequenciaDoMain(tmp, instalacao));

    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('o manifesto assinado não cobre brabo-install-compose.yml');
  });

  it('materializar sem ter verificado é recusa — não há compose não conferido', async () => {
    const { instalacao } = cenario(manifesto());
    const r = await rodar(`materializar_os_arquivos_da_instalacao "${instalacao}"`);
    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('os arquivos da instalação não foram verificados');
    expect(fs.existsSync(path.join(instalacao, 'docker'))).toBe(false);
  });

  it('o que já estava na pasta é SUBSTITUÍDO pela cópia verificada, e um symlink não leva a escrita para fora', async () => {
    publicados = { ...ASSETS };
    const { tmp, instalacao } = cenario(manifesto());
    fs.mkdirSync(path.join(instalacao, 'docker/postgres'), { recursive: true });
    fs.writeFileSync(path.join(instalacao, 'docker/docker-compose.install.yml'), 'compose da versão anterior\n');
    const alvo = path.join(tmpRaiz, `fora-${contador}.sql`);
    fs.writeFileSync(alvo, 'arquivo de outra pessoa\n');
    fs.symlinkSync(alvo, path.join(instalacao, 'docker/postgres/init.sql'));

    const r = await rodar(sequenciaDoMain(tmp, instalacao));

    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain('docker/docker-compose.install.yml: o que estava aqui é substituído pela cópia verificada');
    expect(fs.readFileSync(path.join(instalacao, 'docker/docker-compose.install.yml'), 'utf8')).toBe(
      ASSETS['brabo-install-compose.yml'],
    );
    expect(fs.lstatSync(path.join(instalacao, 'docker/postgres/init.sql')).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(alvo, 'utf8')).toBe('arquivo de outra pessoa\n');
  });
});

describe('install.sh — a ordem em `main` é a garantia', () => {
  /** Só o corpo de `main`, sem comentários. */
  const corpoDoMain = () => {
    const texto = fonte();
    const inicio = texto.indexOf('\nmain() {');
    return texto
      .slice(inicio)
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
  };

  it('verifica os arquivos logo depois da própria origem, e antes de TUDO o que pergunta ou grava', () => {
    const main = corpoDoMain();
    const verificacao = main.indexOf('baixar_e_verificar_os_arquivos_da_instalacao "$URL_DA_RELEASE" "$TMP_VERIFICACAO"');
    expect(verificacao).toBeGreaterThan(main.indexOf('verificar_a_si_mesmo "$plataforma"'));
    for (const depois of [
      'resolver_imagens_do_ghcr',
      'migrar_instalacao_anterior "',
      'Sem terminal interativo',
      'consentir_base',
      'escrever_env "$env_arquivo"',
    ]) {
      expect(main.indexOf(depois), depois).toBeGreaterThan(verificacao);
    }
  });

  it('só materializa depois de gravar o `.env`, e imediatamente antes de subir', () => {
    const main = corpoDoMain();
    const materializa = main.indexOf('materializar_os_arquivos_da_instalacao "$PWD"');
    // A âncora tem de EXISTIR: `indexOf` devolve -1 quando o texto some, e
    // "maior que -1" passaria calado — foi o que a extração de `escrever_env`
    // (AT-083) teria feito com a âncora antiga, `: > "$env_arquivo"`.
    const gravaEnv = main.indexOf('escrever_env "$env_arquivo"');
    expect(gravaEnv).toBeGreaterThan(0);
    expect(materializa).toBeGreaterThan(gravaEnv);
    expect(main.indexOf('up -d --wait')).toBeGreaterThan(materializa);
  });

  it('a migração materializa antes do backup, e a prova roda a cópia verificada antes do `down -v`', () => {
    const texto = fonte();
    const migrar = texto.slice(texto.indexOf('\nmigrar_instalacao_anterior() {'));
    const codigo = migrar
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    const materializa = codigo.indexOf('materializar_os_arquivos_da_instalacao "$PWD"');
    const prova = codigo.indexOf('bash "$PROVA_DE_RESTAURACAO"');
    const delecao = codigo.indexOf('down -v');
    expect(materializa).toBeGreaterThan(-1);
    expect(codigo.indexOf('brabo-backup')).toBeGreaterThan(materializa);
    expect(prova).toBeGreaterThan(materializa);
    expect(delecao).toBeGreaterThan(prova);
  });

  it('o plano diz que verifica, e que nunca usa arquivo que não verificou', () => {
    const plano = execFileSync('bash', [SCRIPT, '--print-plan'], {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    })
      .split('\n')
      .map((l) => l.split('\t'));
    const por = (chave: string) => plano.find(([c]) => c === chave)?.[1];
    expect(por('verificar-arquivos-da-instalacao')).toBe('faz');
    expect(por('usar-arquivo-nao-verificado')).toBe('nunca');
  });
});
