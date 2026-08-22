/**
 * Autenticação do runner contra a api (ADR 0105) — e obtenção do ticket de
 * socket do engine.
 *
 * ## Personal Access Token, não login replicado
 *
 * Até a Onda 2 do ADR 0104, este módulo replicava manualmente o que um
 * browser faz sozinho: e-mail/senha interativos, cookies `brabo_refresh`/
 * `brabo_csrf` gravados em `~/.brabo/runner-credentials.json`, renovação
 * via `/auth/refresh` a cada reconexão. Isso existia só porque o produto
 * não tinha um token de automação de verdade — e publicar o runner no npm
 * naquele estado distribuiria um fluxo de senha+cookie salvo em disco.
 *
 * Agora o runner recebe um Personal Access Token (`brb_…`) pronto — emitido
 * em Configurações do projeto → Tokens de acesso, revogável, com expiração
 * opcional — via `--token` ou `BRABO_ACCOUNT_TOKEN`. `obterToken` é
 * síncrono: não há round-trip de rede nem prompt de terminal para obtê-lo,
 * e ele NUNCA é gravado em disco por este CLI — reintroduzir isso reabriria
 * exatamente o problema que esta onda existe para fechar. A validação de
 * verdade (existe, não revogado, não expirado, escopado a este projeto)
 * acontece do lado da api, a cada chamada (`PatAuthGuard`, RN-424/425).
 */

export class TokenInvalidoError extends Error {}

const PREFIXO_DO_TOKEN = 'brb_';
const TAMANHO_MINIMO = 20;

/**
 * Validação LÉXICA, best-effort — mesmo espírito de `guard.ts` (não é a
 * garantia real, só evita mandar pra api algo que já se sabe errado). Quem
 * recusa de verdade é o `PatAuthGuard` do lado da api.
 */
export function validarFormatoDoToken(bruto: string): void {
  if (!bruto.startsWith(PREFIXO_DO_TOKEN) || bruto.length < TAMANHO_MINIMO) {
    throw new TokenInvalidoError(
      `token inválido — esperado um Personal Access Token no formato ` +
        `"${PREFIXO_DO_TOKEN}...", gerado em Configurações do projeto → ` +
        `Tokens de acesso.`,
    );
  }
}

/**
 * `--token` vence `BRABO_ACCOUNT_TOKEN`. Síncrono, sem fallback
 * interativo — PAT é não-interativo por design (ver docblock do módulo).
 */
export function obterToken(argToken?: string): string {
  const bruto = argToken ?? process.env.BRABO_ACCOUNT_TOKEN;
  if (!bruto) {
    throw new Error(
      'nenhum token informado — use --token <brb_...> ou defina ' +
        'BRABO_ACCOUNT_TOKEN no ambiente. Gere um em Configurações do ' +
        'projeto → Tokens de acesso.',
    );
  }
  validarFormatoDoToken(bruto);
  return bruto;
}

async function tentarLerErro(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { message?: string };
    return corpo.message ? `— ${corpo.message}` : '';
  } catch {
    return '';
  }
}

export interface TicketDoRunner {
  ticket: string;
  engineWsUrl: string;
}

/**
 * `POST /projects/:projectId/runner-ticket` — autenticada por Personal
 * Access Token (`Authorization: Bearer <token>`, `PatAuthGuard`), não pelo
 * fluxo de sessão do resto da api (ADR 0105). Agnóstica a como o token foi
 * obtido — só manda o que `obterToken` devolveu, sem prefixo extra nem
 * strip.
 *
 * Chamada UMA vez por tentativa de conexão — nunca cacheada, porque o
 * ticket é de uso único (mesmo padrão do RN-108 da sessão web).
 */
export async function obterTicketDoRunner(
  apiUrl: string,
  projectId: string,
  token: string,
): Promise<TicketDoRunner> {
  const resposta = await fetch(
    `${apiUrl}/projects/${encodeURIComponent(projectId)}/runner-ticket`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
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
        'confira se a api mudou o formato.',
    );
  }
  return { ticket: corpo.ticket, engineWsUrl: corpo.engineWsUrl };
}
