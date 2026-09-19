import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// O `.env` que o instalador grava é lido por OUTRO programa — o Compose —, e
// arquivo que outro programa parseia se prova contra o PARSER dele, nunca
// contra uma asserção de string (a régua do CLAUDE.md, medida no `#` do `FROM`
// e na unit do systemd com aspas). A AT-083 foi a terceira vez: o
// `SECRET_KEY_BASE` saía de `openssl rand -base64 64`, que QUEBRA a linha aos
// 64 caracteres, e o `.env` ganhava uma segunda linha solta. Medido em 100
// gerações: o Compose recusou 49 ("unexpected character in variable name") e
// ACEITOU 51 — com o segredo cortado em 64 caracteres e uma variável de lixo.
//
// Por isso este spec não pergunta só "parseia?". Ele gera os segredos pela
// função de VERDADE (`gerar_segredos`), grava o arquivo pela função de VERDADE
// (`escrever_env`) — as duas do `install.sh`, carregado por `source` no molde de
// `install-fechamento.spec.ts` — e confere que CADA valor chega INTEIRO ao
// ambiente dos serviços que `docker compose config` resolve contra o compose de
// instalação. Sem `docker compose` na máquina, a metade do parser PULA nomeando
// o motivo; a metade que não precisa dele (nenhum valor com quebra de linha)
// roda sempre.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ, 'install.sh');
const COMPOSE = path.join(RAIZ, 'docker/docker-compose.install.yml');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-install-env-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** O script sem a chamada final de `main`, para ser carregado por `source`. */
function carregavel(): string {
  const texto = fs.readFileSync(SCRIPT, 'utf8');
  const corpo = texto.replace(/\nmain\s+"\$@"\s*$/, '\n');
  if (corpo === texto) throw new Error('não achei a chamada de main para recortar de install.sh');
  const caminho = path.join(tmp, 'install-sem-main.sh');
  fs.writeFileSync(caminho, corpo);
  return caminho;
}

/** Os seis segredos que `gerar_segredos` produz, na ordem em que o bash os imprime. */
const SEGREDOS = [
  'GIT_OAUTH_STATE_SECRET',
  'AUTH_JWT_SECRET',
  'BRABO_SERVICE_TOKEN',
  'CREDENTIALS_MASTER_KEY',
  'SECRET_KEY_BASE',
  'NEO4J_PASSWORD',
] as const;

const IMAGENS = {
  BRABO_API_IMAGE: 'ghcr.io/daneiel/brabo-api@sha256:' + 'a'.repeat(64),
  BRABO_ENGINE_IMAGE: 'ghcr.io/daneiel/brabo-engine@sha256:' + 'b'.repeat(64),
  BRABO_WEB_IMAGE: 'ghcr.io/daneiel/brabo-web@sha256:' + 'c'.repeat(64),
  BRABO_BACKUP_IMAGE: 'ghcr.io/daneiel/brabo-backup@sha256:' + 'd'.repeat(64),
  BRABO_BROKER_IMAGE: 'ghcr.io/daneiel/brabo-broker@sha256:' + 'e'.repeat(64),
};

/**
 * Um ambiente SEM os segredos: se o processo do teste tivesse algum deles
 * exportado, `gerar_segredos` o respeitaria (`${VAR:-...}`) e o Compose o
 * preferiria ao `.env` — e o teste mediria o ambiente de quem roda, não o
 * arquivo.
 */
function ambienteLimpo(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const chave of ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT']) {
    if (process.env[chave] !== undefined) env[chave] = process.env[chave];
  }
  env.NO_COLOR = '1';
  return env;
}

/**
 * Roda `gerar_segredos` e `escrever_env` de verdade. Os valores voltam
 * separados por NUL — o único byte que um valor de variável não pode conter —,
 * para que uma quebra de linha DENTRO de um segredo chegue ao teste intacta, em
 * vez de ser confundida com o separador.
 */
function gerarEnv(
  broker: { ligado: boolean; gid?: string; raiz?: string } = { ligado: false },
): { arquivo: string; valores: Record<string, string>; base: string } {
  const arquivo = path.join(tmp, `env-${Math.random().toString(36).slice(2)}`);
  const base = path.join(tmp, 'projetos');
  fs.mkdirSync(base, { recursive: true });
  // O estado que `consentir_broker` deixaria — as três globais que ele
  // preenche. A PERGUNTA em si é provada em `install-broker.spec.ts`; aqui o
  // que se prova é o ARQUIVO que sai dela, contra o parser do Compose.
  const estadoDoBroker = broker.ligado
    ? `BROKER_LIGADO=sim; DOCKER_GID_MEDIDO='${broker.gid ?? ''}'; RAIZ_GERENCIADA_NO_HOST='${broker.raiz ?? ''}'`
    : 'BROKER_LIGADO=nao';
  const r = spawnSync(
    'bash',
    [
      '-c',
      `source "${carregavel()}"
       BASE_DE_PROJETOS="$1"
       ${estadoDoBroker}
       gerar_segredos
       escrever_env "$2"
       printf '%s\\0' ${SEGREDOS.map((s) => `"$${s}"`).join(' ')}`,
      'install-env',
      base,
      arquivo,
    ],
    { env: { ...ambienteLimpo(), ...IMAGENS }, encoding: 'utf8' },
  );
  expect(r.status, r.stderr).toBe(0);
  const partes = r.stdout.split('\0');
  const valores: Record<string, string> = {};
  SEGREDOS.forEach((nome, i) => {
    valores[nome] = partes[i] ?? '';
  });
  return { arquivo, valores, base };
}

const composeDisponivel = (() => {
  const r = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  return r.status === 0;
})();
const PULAR = composeDisponivel
  ? undefined
  : 'sem `docker compose` nesta máquina — o parser do Compose é o validador, e sem ele esta metade não tem com que provar nada';

describe('o .env do instalador (AT-083)', () => {
  it('nenhum segredo gerado tem quebra de linha — e cada um tem o tamanho que o gerador promete', () => {
    const { valores } = gerarEnv();
    for (const nome of SEGREDOS) {
      expect(valores[nome], nome).not.toMatch(/[\r\n]/);
      expect(valores[nome]!.length, nome).toBeGreaterThan(0);
    }
    // 64 bytes em base64 são 88 caracteres. O defeito cortava em 64 (a linha
    // do `openssl`) — e é o que o Phoenix exige no MÍNIMO, então um segredo
    // truncado ainda subia: nada além deste número diria que ele encolheu.
    expect(valores.SECRET_KEY_BASE).toHaveLength(88);
    expect(valores.AUTH_JWT_SECRET).toHaveLength(44);
  });

  it('o arquivo gravado tem uma linha por variável, e nenhuma solta', () => {
    const { arquivo } = gerarEnv();
    const linhas = fs
      .readFileSync(arquivo, 'utf8')
      .split('\n')
      .filter((l) => l !== '' && !l.startsWith('#'));
    for (const linha of linhas) {
      expect(linha, `linha sem NOME=valor no .env: ${linha}`).toMatch(/^[A-Z][A-Z0-9_]*=/);
    }
    expect(fs.statSync(arquivo).mode & 0o777).toBe(0o600);
  });

  it('o Compose aceita o .env e cada segredo chega INTEIRO aos serviços', (ctx) => {
    if (PULAR) ctx.skip(PULAR);

    const { arquivo, valores } = gerarEnv();
    const r = spawnSync(
      'docker',
      ['compose', '-f', COMPOSE, '--env-file', arquivo, 'config', '--format', 'json'],
      { env: ambienteLimpo(), encoding: 'utf8' },
    );
    expect(r.status, `o Compose recusou o .env que o instalador grava:\n${r.stderr}`).toBe(0);

    const config = JSON.parse(r.stdout) as {
      services: Record<string, { environment?: Record<string, string | null> }>;
    };
    const ambiente = (servico: string) => config.services[servico]?.environment ?? {};

    // Os consumidores de cada segredo no compose de instalação. Igualdade
    // EXATA: aceitar o arquivo com o valor cortado foi o que o Compose fez em
    // metade das gerações.
    expect(ambiente('engine').SECRET_KEY_BASE).toBe(valores.SECRET_KEY_BASE);
    expect(ambiente('engine').BRABO_SERVICE_TOKEN).toBe(valores.BRABO_SERVICE_TOKEN);
    expect(ambiente('api').AUTH_JWT_SECRET).toBe(valores.AUTH_JWT_SECRET);
    expect(ambiente('api').BRABO_SERVICE_TOKEN).toBe(valores.BRABO_SERVICE_TOKEN);
    expect(ambiente('api').CREDENTIALS_MASTER_KEY).toBe(valores.CREDENTIALS_MASTER_KEY);
    expect(ambiente('api').GIT_OAUTH_STATE_SECRET).toBe(valores.GIT_OAUTH_STATE_SECRET);
    expect(ambiente('api').NEO4J_PASSWORD).toBe(valores.NEO4J_PASSWORD);
  });

  it('a forma ANTIGA (`openssl rand -base64 64` cru) é REPROVADA pelo mesmo validador', (ctx) => {
    if (PULAR) ctx.skip(PULAR);

    // A mutação, fixada: o mesmo `escrever_env`, com o SECRET_KEY_BASE gerado
    // como antes. Qualquer que seja o sorteio, uma das duas coisas acontece —
    // o Compose recusa o arquivo, ou o valor chega cortado —, e o teste acima
    // reprovaria nas duas.
    const arquivo = path.join(tmp, 'env-antigo');
    const r = spawnSync(
      'bash',
      [
        '-c',
        `source "${carregavel()}"
         BASE_DE_PROJETOS="$2"
         SECRET_KEY_BASE="$(openssl rand -base64 64)"
         gerar_segredos
         escrever_env "$1"
         printf '%s' "$SECRET_KEY_BASE"`,
        'install-env',
        arquivo,
        path.join(tmp, 'projetos'),
      ],
      { env: { ...ambienteLimpo(), ...IMAGENS }, encoding: 'utf8' },
    );
    expect(r.status, r.stderr).toBe(0);
    const gerado = r.stdout;
    expect(gerado).toContain('\n');

    const c = spawnSync(
      'docker',
      ['compose', '-f', COMPOSE, '--env-file', arquivo, 'config', '--format', 'json'],
      { env: ambienteLimpo(), encoding: 'utf8' },
    );
    if (c.status === 0) {
      const config = JSON.parse(c.stdout) as {
        services: Record<string, { environment?: Record<string, string | null> }>;
      };
      expect(config.services.engine?.environment?.SECRET_KEY_BASE).not.toBe(gerado);
    } else {
      expect(c.stderr).toMatch(/variable name|unexpected character/);
    }
  });
});

// ADR 0162: o bloco do broker no `.env`, provado contra o MESMO parser. O que o
// instalador grava quando a pessoa consente precisa SUBIR o serviço — o
// `COMPOSE_PROFILES` do `--env-file` é o que o liga, sem flag na linha — e
// apontar a api para ele; quando ela não consente, nem um nem outro.
describe('o .env do instalador liga o broker só quando consentido (ADR 0162)', () => {
  type Config = {
    services: Record<
      string,
      { environment?: Record<string, string | null>; group_add?: Array<string | number> }
    >;
  };

  const configDe = (arquivo: string): Config => {
    const r = spawnSync(
      'docker',
      ['compose', '-f', COMPOSE, '--env-file', arquivo, 'config', '--format', 'json'],
      { env: ambienteLimpo(), encoding: 'utf8' },
    );
    expect(r.status, `o Compose recusou o .env:\n${r.stderr}`).toBe(0);
    return JSON.parse(r.stdout) as Config;
  };

  const linhas = (arquivo: string) =>
    fs.readFileSync(arquivo, 'utf8').split('\n').filter((l) => l !== '' && !l.startsWith('#'));

  it('ligado: o arquivo traz o profile, a URL, o gid medido e a raiz — juntos', () => {
    const { arquivo } = gerarEnv({ ligado: true, gid: '984', raiz: '/var/lib/docker/volumes/brabo_project_workspaces/_data' });
    const l = linhas(arquivo);
    expect(l).toContain('COMPOSE_PROFILES=container-broker');
    expect(l).toContain('BROKER_URL=http://broker:8090');
    expect(l).toContain('DOCKER_GID=984');
    expect(l).toContain('PROJECT_WORKSPACES_HOST_ROOT=/var/lib/docker/volumes/brabo_project_workspaces/_data');
  });

  it('desligado: nenhuma das quatro linhas existe — nem a URL, nem o profile', () => {
    const { arquivo } = gerarEnv({ ligado: false });
    const l = linhas(arquivo);
    for (const chave of ['COMPOSE_PROFILES=', 'BROKER_URL=', 'DOCKER_GID=', 'PROJECT_WORKSPACES_HOST_ROOT=']) {
      expect(l.some((linha) => linha.startsWith(chave)), chave).toBe(false);
    }
    // A imagem, sim: o Compose interpola o arquivo inteiro antes de filtrar por
    // profile, e um `${BRABO_BROKER_IMAGE:?…}` sem valor recusaria tudo.
    expect(l.some((linha) => linha.startsWith('BRABO_BROKER_IMAGE='))).toBe(true);
  });

  it('ligado sem o gid medido RECUSA — o script não grava palpite (mutação da guarda)', () => {
    const arquivo = path.join(tmp, 'env-sem-gid');
    const r = spawnSync(
      'bash',
      [
        '-c',
        `source "${carregavel()}"
         BASE_DE_PROJETOS="$2"; BROKER_LIGADO=sim; DOCKER_GID_MEDIDO=''
         gerar_segredos
         escrever_env "$1"`,
        'install-env',
        arquivo,
        path.join(tmp, 'projetos'),
      ],
      { env: { ...ambienteLimpo(), ...IMAGENS }, encoding: 'utf8' },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('sem o gid do socket medido');
    expect(fs.readFileSync(arquivo, 'utf8')).not.toContain('COMPOSE_PROFILES=');
  });

  it('ligado: o Compose sobe o broker SEM flag, com o token, as duas raízes e o gid — e a api aponta para ele', (ctx) => {
    if (PULAR) ctx.skip(PULAR);
    const raiz = '/var/lib/docker/volumes/brabo_project_workspaces/_data';
    const { arquivo, valores, base } = gerarEnv({ ligado: true, gid: '984', raiz });
    const config = configDe(arquivo);

    expect(Object.keys(config.services)).toContain('broker');
    const broker = config.services.broker!;
    expect(broker.environment?.BRABO_SERVICE_TOKEN).toBe(valores.BRABO_SERVICE_TOKEN);
    expect(broker.environment?.NODE_ENV).toBe('production');
    expect(broker.environment?.PROJECT_WORKSPACES_HOST_ROOT).toBe(raiz);
    expect(broker.environment?.BRABO_PROJECTS_HOST_BASE).toBe(base);
    expect((broker.group_add ?? []).map(String)).toEqual(['984']);
    expect(config.services.api?.environment?.BROKER_URL).toBe('http://broker:8090');
  });

  it('desligado: o Compose NÃO sobe o broker, e a api não aponta para lugar nenhum', (ctx) => {
    if (PULAR) ctx.skip(PULAR);
    const { arquivo } = gerarEnv({ ligado: false });
    const config = configDe(arquivo);
    expect(Object.keys(config.services)).not.toContain('broker');
    expect(config.services.api?.environment?.BROKER_URL ?? '').toBe('');
  });
});
