/**
 * Autenticação do runner contra a api — e obtenção do ticket de socket do
 * engine.
 *
 * ## Suposição declarada: NÃO existe "token de conta" pronto para CLI
 *
 * A investigação (CLAUDE.md, Fase 7) apontava para `account_tokens`/
 * `AccountTokenRepository` como o mecanismo de "token de conta" para
 * automação. Não é isso: aquela tabela guarda tokens de USO ÚNICO para
 * e-mail (`email_verification`/`password_reset`/`set_initial_password`) —
 * nada de longa duração, nada pensado para um processo de CLI se
 * autenticar repetidamente. O produto NÃO tem, hoje, um mecanismo de
 * "personal access token" separado do login humano.
 *
 * O que existe de verdade (`apps/api/src/interfaces/http/auth/`) é login
 * por e-mail/senha emitindo um PAR: access token (JWT Ed25519, 15 min por
 * padrão — `AUTH_ACCESS_TOKEN_TTL_MS`) e refresh token opaco, ROTATIVO, em
 * cookie `httpOnly` (`brabo_refresh`, `Path=/auth`) com um cookie CSRF
 * legível ao lado (`brabo_csrf`, `Path=/`) — desenhado para um BROWSER, não
 * para uma CLI.
 *
 * Este módulo replica manualmente o que o browser faz sozinho: guarda os
 * dois valores de cookie (não o cookie inteiro — só o par que o produto usa
 * para autorizar `/auth/refresh`, Fase 7a) e o header `X-CSRF-Token`,
 * persistidos em `~/.brabo/runner-credentials.json` (0600), e troca o
 * access token vencido por um novo via `/auth/refresh` — cujo corpo de
 * resposta e cookies (o refresh ROTACIONA a cada troca, RN-033) são
 * gravados de volta no arquivo.
 *
 * `BRABO_ACCOUNT_TOKEN` continua existindo como atalho — mas ele é
 * interpretado como um ACCESS TOKEN já emitido (não um "token de conta"
 * de vida longa que não existe): só serve enquanto os 15 minutos default
 * não vencerem, sem refresh automático nesse modo. Bom para testar contra
 * um `curl -X POST /auth/login` manual; ruim para um runner de vida longa,
 * que deve preferir o fluxo de login interativo abaixo.
 *
 * **Se a R3 (ou uma decisão posterior) introduzir um token de automação de
 * verdade, este é o módulo a trocar** — o resto do runner não sabe nem
 * precisa saber como o access token foi obtido.
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export interface CredenciaisDeConta {
  refreshToken: string;
  csrfToken: string;
}

export interface AcessoEmitido {
  accessToken: string;
  expiresIn: number;
}

const NOME_DO_COOKIE_REFRESH = 'brabo_refresh';
const NOME_DO_COOKIE_CSRF = 'brabo_csrf';
const CABECALHO_CSRF = 'x-csrf-token';

function caminhoDasCredenciais(): string {
  return join(homedir(), '.brabo', 'runner-credentials.json');
}

function salvarCredenciais(credenciais: CredenciaisDeConta): void {
  const pasta = join(homedir(), '.brabo');
  mkdirSync(pasta, { recursive: true });
  const caminho = caminhoDasCredenciais();
  writeFileSync(caminho, JSON.stringify(credenciais, null, 2), 'utf8');
  try {
    // 0600: só o dono lê/escreve. Não é criptografia — é a mesma disciplina
    // de permissão de arquivo que qualquer credencial local (ex.: chave SSH)
    // já segue. Best-effort: `chmod` pode não existir/funcionar em todo FS
    // (ex.: alguns volumes montados), e falhar aqui não deveria impedir o
    // runner de funcionar.
    chmodSync(caminho, 0o600);
  } catch {
    // segue sem travar
  }
}

function lerCredenciaisPersistidas(): CredenciaisDeConta | null {
  try {
    const bruto = readFileSync(caminhoDasCredenciais(), 'utf8');
    const json = JSON.parse(bruto) as Partial<CredenciaisDeConta>;
    if (typeof json.refreshToken === 'string' && typeof json.csrfToken === 'string') {
      return { refreshToken: json.refreshToken, csrfToken: json.csrfToken };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extrai `brabo_refresh`/`brabo_csrf` dos `Set-Cookie` da resposta de
 * `/auth/login` ou `/auth/refresh`.
 *
 * O valor gerado pelo `TokenFactory`/`randomBytes(...).toString('base64url')`
 * do lado servidor nunca contém `=`, então dividir no PRIMEIRO `=` do par
 * `nome=valor` é seguro.
 */
function extrairCredenciaisDosCookies(resposta: Response): CredenciaisDeConta {
  const bruto =
    typeof resposta.headers.getSetCookie === 'function' ? resposta.headers.getSetCookie() : [];

  let refreshToken: string | undefined;
  let csrfToken: string | undefined;

  for (const linha of bruto) {
    const par = linha.split(';')[0] ?? '';
    const indice = par.indexOf('=');
    if (indice < 0) continue;
    const nome = par.slice(0, indice).trim();
    const valor = par.slice(indice + 1).trim();
    if (nome === NOME_DO_COOKIE_REFRESH) refreshToken = valor;
    if (nome === NOME_DO_COOKIE_CSRF) csrfToken = valor;
  }

  if (!refreshToken || !csrfToken) {
    throw new Error(
      `resposta de auth sem os cookies de sessão esperados (${NOME_DO_COOKIE_REFRESH}/` +
        `${NOME_DO_COOKIE_CSRF}) — o mecanismo de auth mudou do lado da api? ` +
        `Ver o docblock de apps/runner/src/auth.ts.`,
    );
  }

  return { refreshToken, csrfToken };
}

/** Login por e-mail/senha (`POST /auth/login`) — devolve o access e persiste o par de cookies. */
async function login(apiUrl: string, email: string, senha: string): Promise<AcessoEmitido> {
  const resposta = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });

  if (!resposta.ok) {
    throw new Error(`login falhou: HTTP ${resposta.status} ${await tentarLerErro(resposta)}`);
  }

  const acesso = (await resposta.json()) as AcessoEmitido;
  const credenciais = extrairCredenciaisDosCookies(resposta);
  salvarCredenciais(credenciais);
  return acesso;
}

/** Rotaciona o par via `POST /auth/refresh` — usa e SUBSTITUI as credenciais persistidas. */
async function renovar(apiUrl: string, credenciais: CredenciaisDeConta): Promise<AcessoEmitido> {
  const resposta = await fetch(`${apiUrl}/auth/refresh`, {
    method: 'POST',
    headers: {
      cookie: `${NOME_DO_COOKIE_REFRESH}=${credenciais.refreshToken}; ${NOME_DO_COOKIE_CSRF}=${credenciais.csrfToken}`,
      [CABECALHO_CSRF]: credenciais.csrfToken,
    },
  });

  if (!resposta.ok) {
    throw new Error(`refresh falhou: HTTP ${resposta.status} ${await tentarLerErro(resposta)}`);
  }

  const acesso = (await resposta.json()) as AcessoEmitido;
  // A família inteira é revogada se um refresh já usado for reapresentado
  // (RN-033) — por isso o par NOVO precisa substituir o antigo AQUI, antes
  // de qualquer outra coisa, ou uma segunda tentativa com o valor velho
  // derrubaria a sessão inteira.
  const credenciaisNovas = extrairCredenciaisDosCookies(resposta);
  salvarCredenciais(credenciaisNovas);
  return acesso;
}

async function tentarLerErro(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { message?: string };
    return corpo.message ? `— ${corpo.message}` : '';
  } catch {
    return '';
  }
}

// Códigos de tecla lidos em modo raw do stdin, por CÓDIGO e não por
// caractere literal no código-fonte: um caractere de controle colado direto
// é invisível no arquivo e frágil a qualquer normalização de encoding no
// caminho (editor, git, terminal) — `\u00XX` é explícito e sobrevive a isso.
const CODIGO_ENTER_CR = 13; // terminal em modo raw manda CR, não LF
const CODIGO_CTRL_D = 4;
const CODIGO_CTRL_C = 3;
const CODIGO_BACKSPACE_DEL = 127;
const CODIGO_BACKSPACE_BS = 8;

/** `node:readline`, sem eco — leitura interativa de senha no terminal. */
function perguntarSenha(pergunta: string): Promise<string> {
  return new Promise((resolvePromise) => {
    process.stdout.write(pergunta);

    if (!process.stdin.isTTY) {
      // Ambiente não interativo (pipe, CI): lê a linha crua, sem máscara —
      // não há terminal para mascarar, e recusar aqui só tiraria a
      // possibilidade de automatizar via `echo senha | brabo-runner ...`.
      const rl = createInterface({ input: process.stdin });
      rl.question('', (resposta) => {
        rl.close();
        resolvePromise(resposta);
      });
      return;
    }

    let senha = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const aoReceberDados = (char: string) => {
      const codigo = char.charCodeAt(0);

      if (char === '\n' || codigo === CODIGO_ENTER_CR || codigo === CODIGO_CTRL_D) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', aoReceberDados);
        process.stdout.write('\n');
        resolvePromise(senha);
        return;
      }
      if (codigo === CODIGO_CTRL_C) {
        process.stdout.write('\n');
        process.exit(130);
      }
      if (codigo === CODIGO_BACKSPACE_DEL || codigo === CODIGO_BACKSPACE_BS) {
        senha = senha.slice(0, -1);
        return;
      }
      senha += char;
    };

    process.stdin.on('data', aoReceberDados);
  });
}

function perguntar(pergunta: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    rl.question(pergunta, (resposta) => {
      rl.close();
      resolvePromise(resposta);
    });
  });
}

async function loginInterativo(apiUrl: string): Promise<AcessoEmitido> {
  process.stdout.write(
    `\nEste runner precisa de uma sessão sua na api (${apiUrl}) para pedir o ticket ` +
      `do canal do engine. Faça login uma vez — as próximas execuções renovam ` +
      `sozinhas a partir de ~/.brabo/runner-credentials.json.\n\n`,
  );
  const email = await perguntar('E-mail: ');
  const senha = await perguntarSenha('Senha: ');
  return login(apiUrl, email.trim(), senha);
}

/**
 * Obtém um access token válido, na ordem:
 *
 * 1. `BRABO_ACCOUNT_TOKEN` — usado como está, sem refresh (ver docblock);
 * 2. credenciais persistidas — tenta `/auth/refresh`;
 * 3. login interativo — pede e-mail/senha no terminal.
 */
export async function obterAccessToken(apiUrl: string): Promise<string> {
  const doAmbiente = process.env.BRABO_ACCOUNT_TOKEN;
  if (doAmbiente) return doAmbiente;

  const persistidas = lerCredenciaisPersistidas();
  if (persistidas) {
    try {
      const acesso = await renovar(apiUrl, persistidas);
      return acesso.accessToken;
    } catch (erro) {
      process.stderr.write(
        `aviso: não consegui renovar a sessão persistida (${
          erro instanceof Error ? erro.message : String(erro)
        }) — pedindo login de novo.\n`,
      );
    }
  }

  const acesso = await loginInterativo(apiUrl);
  return acesso.accessToken;
}

export interface TicketDoRunner {
  ticket: string;
  engineWsUrl: string;
}

/**
 * `POST /projects/:projectId/runner-ticket` — a rota é da R3, ainda não
 * existe no momento em que este código foi escrito. Este cliente assume o
 * mesmo padrão de autenticação de QUALQUER outra rota protegida da api
 * (`Authorization: Bearer <accessToken>`, `JwtAuthGuard` global) e o
 * contrato de resposta fixado na tarefa: `{ticket, engineWsUrl}`.
 *
 * Chamado UMA vez por tentativa de conexão — nunca cacheado, porque o
 * ticket é de uso único (mesmo padrão do RN-108 da sessão web).
 */
export async function obterTicketDoRunner(
  apiUrl: string,
  projectId: string,
  accessToken: string,
): Promise<TicketDoRunner> {
  const resposta = await fetch(
    `${apiUrl}/projects/${encodeURIComponent(projectId)}/runner-ticket`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );

  if (!resposta.ok) {
    throw new Error(
      `não consegui obter o ticket do runner: HTTP ${resposta.status} ${await tentarLerErro(resposta)}`,
    );
  }

  const corpo = (await resposta.json()) as Partial<TicketDoRunner>;
  if (typeof corpo.ticket !== 'string' || typeof corpo.engineWsUrl !== 'string') {
    throw new Error(
      'resposta de /runner-ticket fora do contrato esperado ({ticket, engineWsUrl}) — ' +
        'confira se a R3 mudou o formato.',
    );
  }
  return { ticket: corpo.ticket, engineWsUrl: corpo.engineWsUrl };
}
