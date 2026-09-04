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
 *
 * ## Segunda forma de autenticação: chave de dispositivo (modo automático)
 *
 * Quando a pasta de trabalho vem do fluxo "configurar pasta
 * automaticamente" do navegador (ver `device-key.ts`), não há PAT — em vez
 * disso há uma chave privada Ed25519 já em disco, colocada ali pelo
 * navegador. `assinarTicketComChaveDeDispositivo` assina um JWT de vida
 * MUITO curta (30s, mesmo espírito do ticket de socket da sessão web,
 * RN-108: janela mínima de replay caso o JWT vaze) a partir dessa chave já
 * CARREGADA em memória pelo chamador — esta função NUNCA lê arquivo, nunca
 * importa `node:fs`; quem lê o arquivo é sempre `device-key.ts`, módulo
 * separado de propósito (ver o docblock dele). Isso preserva a mesma
 * garantia que o teste "nenhum I/O de arquivo" abaixo cobre: `auth.ts`
 * continua sem tocar disco, mesmo ganhando este segundo caminho de
 * autenticação.
 */

import { importJWK, SignJWT } from 'jose';

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

const TTL_JWT_DE_DISPOSITIVO = '30s';

/**
 * Assina um JWT curto (EdDSA/Ed25519, TTL de 30s) a partir de uma JWK
 * privada já CARREGADA em memória — nunca lê arquivo (quem lê é
 * `device-key.ts`). `kid` vai no header protegido, igual ao padrão que
 * `Ed25519AccessTokenIssuer` já usa do lado da api — é o id do registro
 * `runner_device_keys` que a api usa para achar a chave PÚBLICA
 * correspondente e verificar a assinatura. TTL curto de propósito (mesmo
 * espírito do ticket de socket, RN-108): um JWT vazado tem janela mínima de
 * replay.
 */
export async function assinarTicketComChaveDeDispositivo(
  jwkPrivada: object,
  deviceKeyId: string,
  projectId: string,
): Promise<string> {
  const chave = await importJWK(jwkPrivada, 'EdDSA');
  return new SignJWT({ projectId })
    .setProtectedHeader({ alg: 'EdDSA', kid: deviceKeyId })
    .setIssuedAt()
    .setExpirationTime(TTL_JWT_DE_DISPOSITIVO)
    .sign(chave);
}

/**
 * Uma das duas formas de autenticar o runner: o PAT de sempre, ou uma chave
 * de dispositivo local (ver docblock do módulo e `device-key.ts`). Nunca as
 * duas ao mesmo tempo — quem monta este tipo (`index.ts`) já decidiu qual
 * das duas usar antes de chegar aqui.
 */
export type CredencialDeAutenticacao =
  | { tipo: 'token'; token: string }
  | { tipo: 'chave-de-dispositivo'; jwkPrivada: object; deviceKeyId: string };

/**
 * Mesmo contrato de `obterTicketDoRunner`, mas aceitando as DUAS formas de
 * autenticação em vez de só o token PAT. Para `tipo: 'token'`, delega direto
 * (comportamento inalterado). Para `tipo: 'chave-de-dispositivo'`, assina um
 * JWT FRESCO a cada chamada — nunca cacheado entre tentativas de conexão,
 * pelo mesmo motivo do ticket em si: o TTL de 30s só protege de verdade se
 * cada tentativa pedir o seu próprio JWT.
 */
export async function obterTicketDoRunnerComCredencial(
  apiUrl: string,
  projectId: string,
  credencial: CredencialDeAutenticacao,
): Promise<TicketDoRunner> {
  const bearer =
    credencial.tipo === 'token'
      ? credencial.token
      : await assinarTicketComChaveDeDispositivo(
          credencial.jwkPrivada,
          credencial.deviceKeyId,
          projectId,
        );
  return obterTicketDoRunner(apiUrl, projectId, bearer);
}
