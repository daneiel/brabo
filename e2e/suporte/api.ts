/**
 * Semeadura por HTTP — a MESMA cadeia que `docker/smoke.sh` percorre
 * (workspace → projeto → sessão → ativação), aqui para dar ao navegador
 * um alvo para abrir.
 *
 * Por que por HTTP e não pela interface: o navegador é caro e a interface
 * de criação (assistente de projeto, escolha de provider git) não é o que
 * esta camada existe para provar. O que só o navegador prova — cookie
 * httpOnly, CSRF, origem cruzada, handshake do socket — é exercitado nos
 * specs; o resto é preparo, e preparo lento é preparo que fica desligado.
 */

const API = process.env.E2E_API_URL ?? 'http://localhost:3000';

/**
 * A origem da api, para quem precisa emiti-la DENTRO do navegador — é o que
 * torna a chamada cruzada (`:8088` → `:3000`) em vez de mais um `fetch` do
 * Node, que não passa por preflight nenhum.
 */
export const API_URL = API;

/** O usuário que o seed do compose de produção provisiona (ver `smoke.sh`). */
export const USUARIO = {
  email: process.env.E2E_USER ?? 'owner@brabo.dev',
  // A política do domínio exige 12 caracteres — o mesmo default do smoke.
  senha: process.env.E2E_PASSWORD ?? 'brabo12345678',
};

export interface SessaoSemeada {
  workspaceId: string;
  projectId: string;
  sessionId: string;
}

async function json(resposta: Response, oque: string): Promise<Record<string, unknown>> {
  const corpo = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`${oque} respondeu ${resposta.status}: ${corpo.slice(0, 500)}`);
  }
  try {
    return JSON.parse(corpo) as Record<string, unknown>;
  } catch {
    throw new Error(`${oque} não devolveu JSON: ${corpo.slice(0, 500)}`);
  }
}

function exigirId(corpo: Record<string, unknown>, oque: string): string {
  const id = corpo.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`${oque} veio sem id: ${JSON.stringify(corpo).slice(0, 500)}`);
  }
  return id;
}

/**
 * O token de semeadura da execução INTEIRA, memoizado.
 *
 * Não é cache por performance — é o mesmo motivo do projeto `setup`: o
 * lockout por IP não zera no sucesso, ele drena por tempo, e cada arquivo de
 * spec que chamasse `autenticar()` no seu `beforeAll` gastaria mais um do
 * balde. Com `workers: 1` e `fullyParallel: false`, os arquivos rodam no
 * MESMO processo, então esta promessa é compartilhada entre eles e a suite
 * inteira custa UM login de semeadura, quantos specs venham a existir.
 *
 * O access token da api é de vida curta, e é por isso que isto é memoizado
 * por EXECUÇÃO e não persistido em disco: uma execução leva minutos, e a
 * próxima começa do zero.
 */
let tokenDaExecucao: Promise<string> | null = null;

/** Login pelo endpoint da api, para obter o Bearer que semeia o resto. */
export function autenticar(): Promise<string> {
  tokenDaExecucao ??= fazerLogin();
  return tokenDaExecucao;
}

async function fazerLogin(): Promise<string> {
  const resposta = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USUARIO.email, senha: USUARIO.senha }),
  });
  if (resposta.status === 401) {
    // Um 401 aqui quase nunca é senha errada — a senha é constante. O
    // suspeito é o LOCKOUT progressivo por IP do próprio produto
    // (`AUTH_LOCKOUT_IP_THRESHOLDS`, default `20:30,30:120`, janela de 15
    // minutos), que responde com o MESMO 401 uniforme de credencial
    // inválida, de propósito: distinguir os dois seria dizer ao atacante
    // quando ele acertou o e-mail. Cada execução gasta 3 logins — o `setup`,
    // o spec de autenticação e ESTE, memoizado para a suite inteira —, e
    // repetir a suite muitas vezes seguidas estoura o balde. Sem esta
    // mensagem, a próxima pessoa caça um bug de credencial que não existe.
    throw new Error(
      'POST /auth/login respondeu 401. A senha é fixa, então isto provavelmente ' +
        'NÃO é credencial errada: é o lockout por IP (401 uniforme, por desenho). ' +
        'Espere a janela drenar ou suba o compose com AUTH_LOCKOUT_IP_THRESHOLDS ' +
        'mais permissivo. Ver e2e/README.md.',
    );
  }

  const corpo = await json(resposta, 'POST /auth/login');
  const token = corpo.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('login não devolveu accessToken');
  }
  return token;
}

/**
 * Cria workspace → projeto → sessão e ATIVA a sessão.
 *
 * A ativação importa: é ela que faz a api chamar o engine, e sem sessão
 * ativa não há canal `session:<id>` para o navegador tentar abrir.
 * `kind: 'consultiva'` pelo mesmo motivo do smoke — nada aqui ativa
 * EXECUÇÃO, e `execution.activated` em sessão consultiva é 409 por desenho.
 */
export async function semearSessao(token: string): Promise<SessaoSemeada> {
  const cabecalhos = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const sufixo = `${Date.now()}`;

  const workspace = await json(
    await fetch(`${API}/workspaces`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify({ name: `E2E ${sufixo}`, slug: `e2e-${sufixo}` }),
    }),
    'POST /workspaces',
  );
  const workspaceId = exigirId(workspace, 'workspace');

  const projeto = await json(
    await fetch(`${API}/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify({ name: `E2E ${sufixo}`, slug: `e2e-${sufixo}` }),
    }),
    'POST /workspaces/:id/projects',
  );
  const projectId = exigirId(projeto, 'projeto');

  const sessao = await json(
    await fetch(`${API}/projects/${projectId}/sessions`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify({ kind: 'consultiva' }),
    }),
    'POST /projects/:id/sessions',
  );
  const sessionId = exigirId(sessao, 'sessão');

  const ativada = await json(
    await fetch(`${API}/projects/${projectId}/sessions/${sessionId}/transition`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify({ status: 'active' }),
    }),
    'POST .../transition',
  );
  if (ativada.status !== 'active') {
    throw new Error(`sessão não ativou: ${JSON.stringify(ativada).slice(0, 500)}`);
  }

  return { workspaceId, projectId, sessionId };
}

/**
 * Cria workspace → projeto no modo `runner`.
 *
 * Modo `runner` e não o `container` de `semearSessao` porque é ele — e só ele
 * — que `POST /projects/:projectId/runner-ticket` atende: a rota recusa com
 * 400 em qualquer outro modo (`RequestRunnerTicketUseCase`, RN-421/ADR 0104).
 * E é essa rota que prova, do lado do SERVIDOR, que a chave de dispositivo
 * gerada e registrada pelo navegador autentica de verdade.
 *
 * O caminho é só um LÉXICO válido, e isso basta: desde a RN-423/RN-501 a
 * criação em modo `runner` não toca disco nenhum — quem confirma a pasta é o
 * `brabo-runner` conectando, e nenhum runner conecta nesta suite. `/home/…`
 * de propósito: fora das raízes de sistema que `caminhoDeWorkspaceLocalValido`
 * recusa, e fora do `cwd` da api (o checkout do Brabo, recusado nos DOIS
 * sentidos).
 */
export async function semearProjetoRunner(token: string): Promise<{
  workspaceId: string;
  projectId: string;
}> {
  const cabecalhos = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const sufixo = `${Date.now()}`;

  const workspace = await json(
    await fetch(`${API}/workspaces`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify({ name: `E2E chave ${sufixo}`, slug: `e2e-chave-${sufixo}` }),
    }),
    'POST /workspaces',
  );
  const workspaceId = exigirId(workspace, 'workspace');

  const projeto = await json(
    await fetch(`${API}/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify({
        name: `E2E chave ${sufixo}`,
        slug: `e2e-chave-${sufixo}`,
        executionMode: 'runner',
        workspacePath: `/home/e2e-runner/${sufixo}`,
      }),
    }),
    'POST /workspaces/:id/projects (runner)',
  );

  return { workspaceId, projectId: exigirId(projeto, 'projeto') };
}
