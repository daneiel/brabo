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
let loginDaExecucao: Promise<LoginDaSemeadura> | null = null;

interface LoginDaSemeadura {
  token: string;
  cookies: CookieDaSemeadura[];
}

/** Login pelo endpoint da api, para obter o Bearer que semeia o resto. */
export async function autenticar(): Promise<string> {
  loginDaExecucao ??= fazerLogin();
  return (await loginDaExecucao).token;
}

/**
 * O cookie como `BrowserContext.addCookies` o aceita — declarado aqui, e não
 * importado do Playwright, porque este módulo é só `fetch` e não depende dele.
 */
export interface CookieDaSemeadura {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
  expires?: number;
}

let cookiesJaEntregues = false;

/**
 * Os cookies (`brabo_refresh` httpOnly e o par `brabo_csrf`) do MESMO login de
 * semeadura, para um spec que precisa de sessão de NAVEGADOR sem consumir o
 * estado do `setup` (ver "Só UM spec por execução pode usar o estado do
 * `setup`" no README).
 *
 * A semeadura usa só o Bearer desse login, então o refresh dele está intacto —
 * e vale UMA vez, pelo mesmo motivo do estado do `setup`: `RefreshUseCase`
 * rotaciona e revoga a família no reuso. Por isso a entrega é única e a
 * segunda chamada LANÇA, nomeando a regra: um segundo consumidor derrubaria o
 * primeiro, e o vermelho apareceria no spec errado. Nenhum login a mais é
 * gasto do balde do lockout.
 */
export async function cookiesDaSemeadura(): Promise<CookieDaSemeadura[]> {
  if (cookiesJaEntregues) {
    throw new Error(
      'cookiesDaSemeadura() já foi consumida nesta execução: o refresh vale uma ' +
        'vez (rotação com detecção de reuso). Ver e2e/README.md.',
    );
  }
  cookiesJaEntregues = true;
  loginDaExecucao ??= fazerLogin();
  return (await loginDaExecucao).cookies;
}

/**
 * `Set-Cookie` → cookie do Playwright. O domínio é o HOST da api, sem porta:
 * cookie não distingue porta, e é por isso que o `brabo_csrf` gravado por
 * `:3000` é legível pelo JS em `:8088` — o double-submit depende disso.
 */
function lerSetCookie(linha: string): CookieDaSemeadura {
  const [par = '', ...atributos] = linha.split(';').map((p) => p.trim());
  const igual = par.indexOf('=');
  const cookie: CookieDaSemeadura = {
    name: par.slice(0, igual),
    value: par.slice(igual + 1),
    domain: new URL(API).hostname,
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  };
  for (const atributo of atributos) {
    const [chave = '', valor = ''] = atributo.split('=');
    switch (chave.toLowerCase()) {
      case 'path':
        cookie.path = valor;
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'samesite':
        cookie.sameSite = (valor.charAt(0).toUpperCase() + valor.slice(1).toLowerCase()) as
          CookieDaSemeadura['sameSite'];
        break;
      case 'expires':
        cookie.expires = Math.floor(Date.parse(valor) / 1000);
        break;
    }
  }
  return cookie;
}

async function fazerLogin(): Promise<LoginDaSemeadura> {
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
    // quando ele acertou o e-mail. Cada execução gasta 4 logins — o `setup`,
    // o spec de autenticação, ESTE (memoizado para a suite inteira) e o
    // `cookiesDeUmLoginProprio()` de `turno-pelo-canal.spec.ts` —, e
    // repetir a suite muitas vezes seguidas estoura o balde. Sem esta
    // mensagem, a próxima pessoa caça um bug de credencial que não existe.
    throw new Error(
      'POST /auth/login respondeu 401. A senha é fixa, então isto provavelmente ' +
        'NÃO é credencial errada: é o lockout por IP (401 uniforme, por desenho). ' +
        'Espere a janela drenar ou suba o compose com AUTH_LOCKOUT_IP_THRESHOLDS ' +
        'mais permissivo. Ver e2e/README.md.',
    );
  }

  // Lido ANTES do corpo: `json()` consome a resposta, os cabeçalhos não.
  const cookies = resposta.headers.getSetCookie().map(lerSetCookie);
  const corpo = await json(resposta, 'POST /auth/login');
  const token = corpo.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('login não devolveu accessToken');
  }
  return { token, cookies };
}

/** O `sub` do access token — o id do usuário semeado, sem uma chamada a mais. */
function usuarioDoToken(token: string): string {
  const carga = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
    sub?: unknown;
  };
  if (typeof carga.sub !== 'string' || carga.sub.length === 0) {
    throw new Error('access token sem `sub`');
  }
  return carga.sub;
}

/**
 * Propõe na sessão uma ação que a política deixa `pending`, e devolve o id.
 *
 * O TIPO é `write_file`, escolhido por MEDIÇÃO e não por palpite — o motivo
 * inteiro está em `e2e/README.md` ("Qual ação o spec de aprovação propõe"). Em
 * resumo: `decide()` dá `require_approval` a todo tipo sem regra, e o
 * `permissions.json` de um projeto recém-criado é vazio; entre os tipos que
 * ficam `pending`, `write_file` é um dos que NÃO têm executor na api
 * (`ApproveActionUseCase` o devolve aprovado sem efeito), e com ator `user`
 * nenhum agente espera por ele no engine. Se o spec um dia aprovasse em vez
 * de recusar, nada seria escrito em disco nenhum.
 *
 * Nasce `pending` ou este preparo LANÇA: uma mudança de política que o
 * auto-aprovasse faria o card nunca ter botões, e o spec acusaria a tela.
 */
export async function proporAcaoPendente(token: string, sessao: SessaoSemeada): Promise<string> {
  const acao = await json(
    await fetch(`${API}/projects/${sessao.projectId}/sessions/${sessao.sessionId}/actions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'write_file',
        actor: { kind: 'user', id: usuarioDoToken(token) },
        payload: { path: 'e2e/aprovacao-inline.txt', content: 'nunca escrito: o spec recusa.\n' },
      }),
    }),
    'POST .../actions',
  );
  if (acao.status !== 'pending') {
    throw new Error(
      `a ação não nasceu pending (status ${String(acao.status)}, política ` +
        `${String(acao.resolvedPolicy)}): sem pendência não há o que decidir na tela`,
    );
  }
  return exigirId(acao, 'ação');
}

/** Os ids das ações `pending` da sessão, lidos pela api — a FILA, não a tela. */
export async function idsPendentes(token: string, sessao: SessaoSemeada): Promise<string[]> {
  const pagina = await json(
    await fetch(
      `${API}/projects/${sessao.projectId}/sessions/${sessao.sessionId}/actions?latest=true&status=pending`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
    'GET .../actions?status=pending',
  );
  const itens = Array.isArray(pagina.items) ? (pagina.items as Array<{ id?: unknown }>) : [];
  return itens.map((i) => String(i.id));
}

/**
 * Cria workspace → projeto → sessão e ATIVA a sessão.
 *
 * A ativação importa: é ela que faz a api chamar o engine, e sem sessão
 * ativa não há canal `session:<id>` para o navegador tentar abrir.
 * `kind: 'consultiva'` por padrão, pelo mesmo motivo do smoke — nada aqui
 * ativa EXECUÇÃO, e `execution.activated` em sessão consultiva é 409 por
 * desenho. `criativa` é a de `semearSessaoSemCredencial`: é o único `kind` em
 * que o composer oferece um destinatário (o Criativo) antes de qualquer
 * ativação (RN-631).
 */
export async function semearSessao(
  token: string,
  kind: 'consultiva' | 'criativa' = 'consultiva',
): Promise<SessaoSemeada> {
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
      body: JSON.stringify({ kind }),
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

/**
 * Um login PRÓPRIO, com os cookies (`brabo_refresh` httpOnly e `brabo_csrf`)
 * para um contexto de navegador — fora da memoização de `autenticar()`.
 *
 * Existe porque os dois estados de navegador que a execução já tem são de
 * outros specs, e cada um vale UMA vez (ver "Só UM spec por execução pode usar
 * o estado do `setup`" no README): o do `setup` é de
 * `socket-da-sessao.spec.ts`, e os cookies da semeadura são de
 * `aprovacao-inline.spec.ts`. Um terceiro spec com sessão de navegador precisa
 * de um refresh que ninguém mais use — e isso custa UM login a mais do balde
 * do lockout por IP, contado no README. Não memoize: memoizar devolveria o
 * mesmo refresh a dois consumidores, que é o defeito que esta função evita.
 */
export async function cookiesDeUmLoginProprio(): Promise<CookieDaSemeadura[]> {
  return (await fazerLogin()).cookies;
}

export interface SessaoSemCredencial extends SessaoSemeada {
  /** O provider do modelo vinculado — o que NÃO tem credencial do dono. */
  provider: string;
  modelId: string;
}

interface ModeloDoCatalogo {
  id: string;
  provider: string;
  supportsToolCalling: boolean;
  availability: string;
}

/**
 * Sessão CRIATIVA num workspace cujo modelo é de um provider SEM credencial do
 * dono — o turno do Criativo sobe, pede o modelo à api e FALHA antes de
 * qualquer chamada de rede ao provider (AT-338). Sem LLM e sem custo.
 *
 * O desfecho foi lido no código, não suposto: `StreamLlmTurnUseCase` resolve o
 * binding, confere o orçamento e, para provider que não é `ollama`, procura a
 * credencial do DONO do workspace (RN-058); sem ela, o frame final é
 * `Nenhuma credencial cadastrada para <provider>`. O `CriativoServer` o
 * recebe como `{:final, texto}`, e `Engine.Agents.FalhaDeTurno.origem/1`
 * classifica `credencial` como `politica` (RN-059).
 *
 * Por que vincular um modelo, em vez de deixar o workspace novo sem nenhum: sem
 * binding o texto seria OUTRO (`Nenhum modelo vinculado para esta sessão`),
 * também `politica`, e o spec provaria um desfecho que ninguém pediu. E por que
 * não o workspace do seed: ele vincula o modelo LOCAL (`ollama`), que não pede
 * credencial — o turno tentaria o daemon, que o compose de produção não sobe
 * fora do profile `llm`, e a falha seria de `infra`.
 *
 * O modelo sai do catálogo que o seed semeia, com três filtros: aceita
 * ferramentas (o Criativo pede `emit_artifact`, e a cascata PULA modelo sem
 * tool calling — cairia de novo em "nenhum modelo"), não está
 * `unavailable`, e o provider dele não tem credencial do usuário (o seed pode
 * gravar credenciais a partir do ambiente). Se nenhum servir, LANÇA dizendo
 * por quê: sem isso o spec veria um turno que DEU CERTO, gastando token.
 */
export async function semearSessaoSemCredencial(token: string): Promise<SessaoSemCredencial> {
  const cabecalhos = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const sessao = await semearSessao(token, 'criativa');

  const credenciais = await fetch(`${API}/users/me/credentials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const corpoDasCredenciais = await credenciais.text();
  if (!credenciais.ok) {
    throw new Error(
      `GET /users/me/credentials respondeu ${credenciais.status}: ${corpoDasCredenciais.slice(0, 500)}`,
    );
  }
  const comCredencial = new Set(
    (JSON.parse(corpoDasCredenciais) as Array<{ provider?: unknown }>).map((c) =>
      String(c.provider),
    ),
  );

  const catalogo = (await json(
    await fetch(`${API}/workspaces/${sessao.workspaceId}/models/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    'GET /workspaces/:id/models/catalog',
  )) as { local?: Record<string, ModeloDoCatalogo[]>; cloud?: Record<string, ModeloDoCatalogo[]> };
  const modelo = Object.values(catalogo.cloud ?? {})
    .flat()
    .find(
      (m) =>
        m.provider !== 'ollama' &&
        m.supportsToolCalling &&
        m.availability !== 'unavailable' &&
        !comCredencial.has(m.provider),
    );
  if (!modelo) {
    throw new Error(
      'nenhum modelo de nuvem com tool calling num provider SEM credencial do ' +
        `usuário (credenciais: ${[...comCredencial].join(', ') || 'nenhuma'}): o ` +
        'turno não falharia por credencial. Ver semearSessaoSemCredencial.',
    );
  }

  await json(
    await fetch(`${API}/workspaces/${sessao.workspaceId}/models/activate`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify({ modelIds: [modelo.id], isActive: true }),
    }),
    'POST /workspaces/:id/models/activate',
  );
  await json(
    await fetch(`${API}/workspaces/${sessao.workspaceId}/model-binding`, {
      method: 'PUT',
      headers: cabecalhos,
      body: JSON.stringify({ modelId: modelo.id }),
    }),
    'PUT /workspaces/:id/model-binding',
  );

  return { ...sessao, provider: modelo.provider, modelId: modelo.id };
}
