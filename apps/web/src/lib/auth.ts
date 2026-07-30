import { logger } from './logger';
import { runtimeConfig } from './runtime-config';

/**
 * A sessão da web (Fase 7a — o corte).
 *
 * ## Onde cada token mora, e por quê
 *
 * O **access token** vive nesta variável de módulo — memória, nunca storage.
 * Ele dura 15 minutos e some ao recarregar a página, o que é aceitável porque
 * a linha abaixo o reconstrói.
 *
 * O **refresh** não passa por aqui em momento nenhum: ele está num cookie
 * `httpOnly` que este código não consegue ler. O browser o anexa sozinho às
 * chamadas de `/auth/*`. É isso que faz a sessão sobreviver ao reload sem
 * `localStorage` — e é o ponto inteiro da escolha: um XSS não alcança a
 * sessão longa, só os 15 minutos do access.
 *
 * O par do cookie é o `brabo_csrf`, que É legível e vai no cabeçalho
 * `X-CSRF-Token`. Ele não é segredo: é prova de mesma origem.
 */
const API_URL = runtimeConfig.apiUrl;

let accessToken: string | null = null;
let refreshEmVoo: Promise<string | null> | null = null;

type Ouvinte = (autenticado: boolean) => void;
const ouvintes = new Set<Ouvinte>();

function anunciar(): void {
  for (const ouvinte of ouvintes) ouvinte(accessToken !== null);
}

export function onMudancaDeSessao(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

export function temSessao(): boolean {
  return accessToken !== null;
}

export function tokenAtual(): string | null {
  return accessToken;
}

/**
 * O e-mail da sessão, lido do payload do access token.
 *
 * Decodifica sem verificar assinatura, e isso está certo: quem valida o token
 * é a api, a cada requisição. Aqui o valor serve só para EXIBIR — se alguém
 * forjar um payload no próprio browser, terá conseguido mentir para si mesmo.
 * Nenhuma decisão de autorização passa por este valor.
 */
export function emailDaSessao(): string | null {
  if (!accessToken) return null;
  try {
    const payload = accessToken.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { email?: string };
    return claims.email ?? null;
  } catch {
    // Token que a api emitiu e o browser não consegue decodificar é defeito de
    // formato, não de uso — `debug` porque só interessa investigando, e a tela
    // apenas deixa de mostrar o e-mail.
    logger.debug('access token não decodificável');
    return null;
  }
}

function guardar(token: string | null): void {
  accessToken = token;
  anunciar();
}

/** Lê o cookie de CSRF. É o único cookie de sessão que o JS enxerga. */
function csrf(): string {
  const par = document.cookie
    .split('; ')
    .find((c) => c.startsWith('brabo_csrf='));
  return par ? decodeURIComponent(par.slice('brabo_csrf='.length)) : '';
}

/**
 * `credentials: 'include'` em tudo que fala com `/auth/*`.
 *
 * Sem isso o browser NÃO manda o cookie para outra origem, e como a api roda
 * em `localhost:3000` contra a web em `localhost:5173`, o refresh falharia
 * silenciosamente em desenvolvimento — e funcionaria em qualquer ambiente de
 * origem única, que é a pior combinação possível para descobrir o erro.
 */
async function postAuth(
  caminho: string,
  corpo?: unknown,
): Promise<Response> {
  return fetch(`${API_URL}/auth/${caminho}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf(),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

/**
 * Renova o access token — em SINGLE-FLIGHT.
 *
 * Esta é a peça sem a qual o sistema desloga o usuário pelo uso normal, e o
 * ADR 0031 a registrou como requisito desta fase, não como otimização.
 *
 * O refresh rotaciona: cada uso consome o token e emite outro. Se duas
 * chamadas levarem 401 ao mesmo tempo e cada uma disparar seu próprio
 * refresh, a segunda apresenta um token que a primeira já consumiu — que é,
 * do lado do servidor, a assinatura EXATA de um roubo. A família é revogada,
 * e o usuário é deslogado por ter duas requisições em paralelo.
 *
 * Uma promessa só, compartilhada por todos os chamadores, elimina isso na
 * origem.
 */
export function renovarSessao(): Promise<string | null> {
  refreshEmVoo ??= (async () => {
    try {
      const res = await postAuth('refresh');
      if (!res.ok) {
        // Registrado a partir do ADR 0035. Este é o caminho pelo qual o usuário
        // é deslogado, e era silencioso: "fui jogado para o login do nada" não
        // deixava rastro nenhum, e a diferença entre refresh expirado (esperado)
        // e família revogada por reuso (incidente de segurança) é justamente o
        // status.
        logger.warn('renovação de sessão recusada', { status: res.status });
        guardar(null);
        return null;
      }
      const dados = (await res.json()) as { accessToken: string };
      guardar(dados.accessToken);
      return dados.accessToken;
    } catch (erro) {
      // Falha de rede na renovação: mesmo desfecho, causa completamente
      // diferente da recusa acima.
      logger.warn('renovação de sessão falhou por rede', {
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      guardar(null);
      return null;
    } finally {
      // Zerado no `finally` para a PRÓXIMA renovação poder acontecer. Deixar
      // a promessa resolvida no lugar transformaria o single-flight em
      // "renova uma vez só, para sempre".
      refreshEmVoo = null;
    }
  })();

  return refreshEmVoo;
}

/**
 * Tenta reconstruir a sessão no boot da aplicação.
 *
 * O cookie httpOnly é a única memória que sobrevive ao reload. Se ele não
 * existe ou expirou, o resultado é `false` e a app manda para o login.
 */
export async function restaurarSessao(): Promise<boolean> {
  return (await renovarSessao()) !== null;
}

export async function entrar(
  email: string,
  senha: string,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const res = await postAuth('login', { email, senha });
  if (!res.ok) {
    guardar(null);
    return { ok: false, status: res.status };
  }
  const dados = (await res.json()) as { accessToken: string };
  guardar(dados.accessToken);
  return { ok: true };
}

export async function sair(): Promise<void> {
  try {
    await postAuth('logout');
  } catch {
    // Engolido de propósito, e `catch` — não `finally`. Com `finally` a
    // limpeza aconteceria, mas a rejeição continuaria subindo e o componente
    // que chamou veria um erro numa ação que, do ponto de vista do usuário,
    // deu certo: ele saiu.
  }
  // Local sempre: o usuário pediu para sair, e uma api fora do ar não pode ser
  // motivo para ele continuar vendo a aplicação logada.
  guardar(null);
}

export async function registrar(
  email: string,
  senha: string,
  nome?: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await postAuth('register', { email, senha, nome });
  return { ok: res.ok, status: res.status };
}

export async function pedirRedefinicao(
  email: string,
): Promise<{ ok: boolean }> {
  const res = await postAuth('request-password-reset', { email });
  return { ok: res.ok };
}

export async function definirSenha(
  token: string,
  novaSenha: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await postAuth('reset-password', { token, novaSenha });
  return { ok: res.ok, status: res.status };
}

export async function verificarEmail(
  token: string,
): Promise<{ ok: boolean }> {
  const res = await postAuth('verify-email', { token });
  return { ok: res.ok };
}
