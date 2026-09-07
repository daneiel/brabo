import { expect, test } from '@playwright/test';
import { API_URL, autenticar, semearProjetoRunner } from '../suporte/api.ts';

/**
 * A chave de dispositivo do runner (Ed25519, ADR 0118) gerada num Chromium de
 * VERDADE, e o `kid` da RN-475 provado contra o servidor.
 *
 * ## A lacuna que este arquivo fecha
 *
 * `apps/web/src/lib/runner-bootstrap.test.ts` faz
 * `vi.stubGlobal('crypto', { subtle: { … } })` em todo teste que toca chave.
 * A suite do web, portanto, **nunca gerou uma chave Ed25519**, nunca exportou
 * uma JWK de verdade e não tem como afirmar que o arquivo que o navegador
 * grava é algo que o CLI e o `PatAuthGuard` aceitariam. Não é descuido dela:
 * `crypto.subtle.generateKey({ name: 'Ed25519' })` **não existe em jsdom**, e
 * um dublê é a única saída lá embaixo.
 *
 * E é exatamente por essa fresta que a RN-475 passou. O navegador descartava
 * o `id` do registro, a JWK gravada nascia sem `kid`, o CLI a recusava
 * sempre — e o teste que deixou passar afirmava que o arquivo tinha sido
 * ABERTO, nunca o que havia DENTRO dele. O modo automático do ADR 0118 nunca
 * autenticou nenhuma vez desde que nasceu.
 *
 * Este spec é a camada onde essa asserção cabe (ADR 0120): Ed25519 real,
 * origem cruzada real (`:8088` → `:3000`, com preflight, porque
 * `Authorization` não é cabeçalho simples), e o veredito de aceitação vindo
 * do PRÓPRIO servidor, não de um dublê.
 *
 * ## Que metade está coberta, e qual NÃO está
 *
 * COBERTA — a metade CRIPTOGRÁFICA e de PROTOCOLO, ponta a ponta: gerar o
 * par no navegador, exportar as duas JWKs, registrar a pública, carimbar a
 * privada com o `id` do registro, assinar o JWT de ticket com ela e ver a api
 * ACEITAR. Se o `kid` sumir de novo em qualquer elo, a rota responde 401 e
 * este spec fica vermelho — que é a prova que faltava.
 *
 * NÃO COBERTA — a metade de INTERFACE de `configurarPastaAutomaticamente`:
 * `showDirectoryPicker` (a File System Access API) devolve um handle que o
 * Playwright não tem como conceder, então o fluxo não é dirigido pelo
 * `RunnerOnboardingPanel` e o código de `apps/web/src/lib/runner-bootstrap.ts`
 * **não é o código executado aqui** — os passos são reproduzidos na página,
 * na mesma ordem e com as mesmas chamadas de Web Crypto. Consequência
 * honesta: este spec prova que a CADEIA aceita uma chave feita assim, e não
 * que o módulo do produto a faz assim. Quem prova a segunda metade é
 * `runner-bootstrap.test.ts`, com o dublê — as duas juntas cobrem o que
 * nenhuma cobre sozinha, e essa divisão é a razão de esta observação estar
 * escrita e não subentendida.
 *
 * A gravação em disco (os três arquivos da RN-466) também fica fora, pelo
 * mesmo motivo: sem handle de pasta, não há disco onde escrever.
 *
 * Seletor estrutural e asserção sobre mecanismo continuam valendo — aqui não
 * há seletor NENHUM, de propósito: nada do que este spec afirma tem
 * representação em tela.
 */

/**
 * O passo 3 da RN-473 reproduzido DENTRO da página, com Web Crypto nativo.
 *
 * Roda em `page.evaluate`, então precisa ser autocontido (nada de import, nada
 * de closure sobre o escopo do Node). O que ele devolve é o material bruto —
 * as asserções ficam do lado do teste, onde falham com mensagem.
 */
async function gerarRegistrarEAssinarNoNavegador(entrada: {
  api: string;
  projectId: string;
  nome: string;
  token: string;
}): Promise<{
  registroId: string;
  publicaJwk: string;
  arquivoPrivado: string;
  jwtDeTicket: string;
}> {
  const { api, projectId, nome, token } = entrada;

  const paraBase64Url = (bytes: ArrayBuffer): string => {
    let bruto = '';
    for (const b of new Uint8Array(bytes)) bruto += String.fromCharCode(b);
    return btoa(bruto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const textoParaBase64Url = (texto: string): string =>
    paraBase64Url(new TextEncoder().encode(texto).buffer as ArrayBuffer);

  // `gerarParDeChaves` — o algoritmo, a extraibilidade e os dois usos são os
  // mesmos de `runner-bootstrap.ts`. Em jsdom esta linha lança.
  const par = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

  // `exportarJwkPublica` — a pública vai CRUA, sem `kid`: é o registro dela
  // que produz o id.
  const publicaJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', par.publicKey));

  const registro = await fetch(`${api}/projects/${projectId}/runner-device-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: nome, publicKeyJwk: publicaJwk }),
  });
  if (registro.status !== 201) {
    throw new Error(
      `POST runner-device-keys respondeu ${registro.status}: ${(await registro.text()).slice(0, 300)}`,
    );
  }
  const registrada = (await registro.json()) as { id?: unknown };
  if (typeof registrada.id !== 'string' || registrada.id.length === 0) {
    throw new Error('registro de chave de dispositivo veio sem id');
  }

  // `exportarJwkPrivada(par, registro.id)` — o carimbo do `kid` (RN-475). É
  // ESTE texto que o navegador grava em `brabo-runner-device-key.jwk.json`.
  const arquivoPrivado = JSON.stringify({
    ...(await crypto.subtle.exportKey('jwk', par.privateKey)),
    kid: registrada.id,
  });

  // `assinarTicketComChaveDeDispositivo` (apps/runner/src/auth.ts): EdDSA,
  // `kid` no header protegido, `projectId` no payload, TTL de 30s. O `kid`
  // é lido DE VOLTA do arquivo, como `lerChaveDeDispositivo` faz — nunca da
  // variável que acabou de escrevê-lo. Sem isso, um arquivo sem `kid`
  // continuaria produzindo um JWT válido e o teste passaria mentindo.
  const doArquivo = JSON.parse(arquivoPrivado) as { kid?: unknown };
  const agora = Math.floor(Date.now() / 1000);
  const cabecalhoEPayload =
    `${textoParaBase64Url(JSON.stringify({ alg: 'EdDSA', kid: doArquivo.kid }))}.` +
    `${textoParaBase64Url(JSON.stringify({ projectId, iat: agora, exp: agora + 30 }))}`;
  const assinatura = await crypto.subtle.sign(
    { name: 'Ed25519' },
    par.privateKey,
    new TextEncoder().encode(cabecalhoEPayload),
  );

  return {
    registroId: registrada.id,
    publicaJwk,
    arquivoPrivado,
    jwtDeTicket: `${cabecalhoEPayload}.${paraBase64Url(assinatura)}`,
  };
}

interface ChaveNaLista {
  id: string;
  name: string;
  projectId: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/**
 * Sem o estado guardado — e a razão NÃO é a de `autenticacao.spec.ts`.
 *
 * Este spec não precisa de sessão de navegador nenhuma: ele fala com a api
 * por Bearer (o token de semeadura), e o que quer da página é só a ORIGEM
 * (`:8088`), para que o `fetch` seja cruzado de verdade.
 *
 * E ele não pode gastar o estado, porque o refresh é de USO ÚNICO por
 * construção: `RefreshUseCase` rotaciona e tem detecção de REUSO, que revoga
 * a FAMÍLIA inteira. Um segundo contexto de navegador carregando o app com o
 * MESMO `brabo_refresh` gravado em `.estado-autenticado.json` não só falha —
 * ele derruba a sessão para todos os specs seguintes, que passam a cair no
 * login. Foi exatamente o que aconteceu ao rodar este arquivo com
 * `storageState` herdado: `socket-da-sessao.spec.ts`, o próximo em ordem
 * alfabética, ficou vermelho acusando o socket, que não é onde o defeito
 * estava.
 *
 * Consequência para quem escrever o PRÓXIMO spec: só UM arquivo por execução
 * pode consumir o estado do `setup`. Quem não precisa de sessão de navegador
 * opta por sair, como aqui.
 */
test.use({ storageState: { cookies: [], origins: [] } });

let projectId: string;
let token: string;

test.beforeAll(async () => {
  token = await autenticar();
  ({ projectId } = await semearProjetoRunner(token));
});

// Uma navegação por teste, e nunca à toa: é ela que põe o contexto de
// execução na origem da WEB (`:8088`). Sem isso os `fetch` sairiam do Node,
// mesma origem de ninguém, e a chamada cruzada — que é metade do que esta
// camada existe para exercitar — não aconteceria. Sem sessão, `/` redireciona
// para o login; a origem é a mesma, e é só dela que este spec precisa.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a JWK privada nasce com o `kid` do registro, e o servidor aceita o JWT assinado com ela', async ({
  page,
}) => {
  const feito = await page.evaluate(gerarRegistrarEAssinarNoNavegador, {
    api: API_URL,
    projectId,
    nome: 'e2e · chave do navegador',
    token,
  });

  // A asserção que faltava (RN-475). O `kid` gravado É o `id` que o servidor
  // devolveu — não um id derivado, inventado, nem ausente.
  const privada = JSON.parse(feito.arquivoPrivado) as Record<string, unknown>;
  expect(privada.kid, 'a JWK privada gravada saiu sem `kid`').toBe(feito.registroId);

  // E ela é mesmo a PRIVADA: `d` é o escalar secreto de uma OKP (RFC 8037).
  // Sem esta linha, um arquivo com a chave pública carimbada passaria.
  expect(privada.kty).toBe('OKP');
  expect(privada.crv).toBe('Ed25519');
  expect(typeof privada.d, 'a JWK gravada não é a privada').toBe('string');

  // O `kid` vai só na privada: a pública é registrada ANTES de o id existir,
  // e carimbá-la seria inventar um vínculo que o servidor não pediu.
  expect(JSON.parse(feito.publicaJwk)).not.toHaveProperty('kid');
  expect(JSON.parse(feito.publicaJwk)).not.toHaveProperty('d');

  // O veredito do SERVIDOR, que é o que a suite do web não tem como obter: o
  // `PatAuthGuard` acha a pública por esse `kid` e verifica a assinatura. Um
  // arquivo sem `kid` (o defeito da RN-475) para exatamente aqui, com 401.
  const ticket = await page.evaluate(
    async ([api, projeto, jwt]) => {
      const r = await fetch(`${api}/projects/${projeto}/runner-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
      });
      return { status: r.status, corpo: await r.text() };
    },
    [API_URL, projectId, feito.jwtDeTicket] as const,
  );

  expect(
    ticket.status,
    `a api recusou o JWT assinado com a chave de dispositivo: ${ticket.corpo.slice(0, 300)}`,
  ).toBe(201);
  expect(JSON.parse(ticket.corpo)).toMatchObject({
    ticket: expect.any(String),
    engineWsUrl: expect.stringMatching(/^wss?:\/\/.+\/runner$/),
  });
});

test('a listagem mostra a chave sem a JWK, e a revogada continua lá — sem servir mais', async ({
  page,
}) => {
  const feito = await page.evaluate(gerarRegistrarEAssinarNoNavegador, {
    api: API_URL,
    projectId,
    nome: 'e2e · chave a revogar',
    token,
  });

  const listar = async (): Promise<{ bruto: string; chaves: ChaveNaLista[] }> => {
    const bruto = await page.evaluate(
      async ([api, projeto, bearer]) => {
        const r = await fetch(`${api}/projects/${projeto}/runner-device-keys`, {
          headers: { Authorization: `Bearer ${bearer}` },
        });
        if (r.status !== 200) throw new Error(`GET runner-device-keys respondeu ${r.status}`);
        return r.text();
      },
      [API_URL, projectId, token] as const,
    );
    return { bruto, chaves: JSON.parse(bruto) as ChaveNaLista[] };
  };

  const antes = await listar();
  const registrada = antes.chaves.find((c) => c.id === feito.registroId);
  expect(registrada, 'a chave registrada não apareceu na listagem (RN-519)').toBeDefined();
  expect(registrada?.revokedAt, 'chave recém-registrada não pode nascer revogada').toBeNull();

  // A privada NUNCA saiu do navegador, e a pública a lista não devolve
  // (RN-519). Comparado sobre o texto BRUTO de propósito: um campo novo com
  // outro nome carregando a mesma coisa também cairia aqui.
  expect(antes.bruto).not.toContain('publicKeyJwk');
  expect(antes.bruto).not.toContain('"d"');

  const revogacao = await page.evaluate(
    async ([api, projeto, chave, bearer]) => {
      const r = await fetch(`${api}/projects/${projeto}/runner-device-keys/${chave}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bearer}` },
      });
      return r.status;
    },
    [API_URL, projectId, feito.registroId, token] as const,
  );
  expect(revogacao).toBe(204);

  const depois = await listar();
  const revogada = depois.chaves.find((c) => c.id === feito.registroId);
  // A revogada FICA na lista (RN-519): sumir com a linha faria a tela afirmar
  // que a chave nunca existiu.
  expect(revogada, 'a chave revogada sumiu da listagem').toBeDefined();
  expect(revogada?.revokedAt, 'a revogação não apareceu na listagem').not.toBeNull();

  // E revogar é revogar de verdade, não só sumir de uma tela: o MESMO JWT,
  // ainda dentro do TTL, deixa de ser aceito.
  const depoisDaRevogacao = await page.evaluate(
    async ([api, projeto, jwt]) => {
      const r = await fetch(`${api}/projects/${projeto}/runner-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
      });
      return r.status;
    },
    [API_URL, projectId, feito.jwtDeTicket] as const,
  );
  expect(depoisDaRevogacao, 'a chave revogada continuou emitindo ticket').toBe(401);
});
