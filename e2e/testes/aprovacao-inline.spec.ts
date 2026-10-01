import { expect, test } from '@playwright/test';
import {
  autenticar,
  cookiesDaSemeadura,
  idsPendentes,
  proporAcaoPendente,
  semearSessao,
  type SessaoSemeada,
} from '../suporte/api.ts';

/**
 * A aprovação INLINE — uma `proposed_action` decidida de dentro do chat da
 * sessão, com o navegador em `:8088` e a api em `:3000` (AT-068).
 *
 * O que só este nível prova, e o que a medição corrigiu no enunciado: o POST
 * de DECISÃO não leva CSRF. Ele vai com o `Authorization: Bearer` do access em
 * memória — `X-CSRF-Token` é exigido só nas rotas de `/auth`
 * (`session-cookies.ts`: "mantê-lo fora do cookie evita ter que exigir CSRF em
 * TODA rota autenticada"). A cadeia que só um browser monta é, então:
 *
 * 1. `POST /auth/refresh` em ORIGEM CRUZADA, com o cookie httpOnly que o JS
 *    não lê e o `X-CSRF-Token` que ele lê do `brabo_csrf` — é daí que sai o
 *    access da página;
 * 2. o POST de decisão, também cruzado (preflight de CORS por causa do
 *    `Authorization`), com esse access;
 * 3. a FILA refletindo a decisão — lida pela api, não pela tela.
 *
 * Asserção sobre as REQUISIÇÕES observadas; o card é só onde se clica. O
 * seletor é estrutural: o card do chat é o único lugar da sessão com
 * `data-testid="motivo-da-politica"`, e o botão de recusar é o SEGUNDO do grupo
 * de ações dele (aprovar, recusar, sempre permitir) — se a ordem mudar, o
 * clique cai noutro botão e o spec reprova esperando o `/deny`, nunca passa
 * decidindo outra coisa.
 *
 * O spec RECUSA, e não aprova. `write_file` com ator `user` não tem efeito nem
 * aprovado (ver `proporAcaoPendente`), mas recusar é o desfecho que não
 * depende disso continuar verdade.
 *
 * Sessão de navegador SEM o estado do `setup`: ele é de
 * `socket-da-sessao.spec.ts`, e este arquivo roda antes na ordem alfabética —
 * usá-lo aqui rotacionaria o refresh e derrubaria aquele spec. Os cookies vêm
 * do login de SEMEADURA (`cookiesDaSemeadura`), que não custa login a mais.
 */

test.use({ storageState: { cookies: [], origins: [] } });

let semeada: SessaoSemeada;
let token: string;
let acaoId: string;

test.beforeAll(async () => {
  token = await autenticar();
  semeada = await semearSessao(token);
  acaoId = await proporAcaoPendente(token, semeada);
});

test('a decisão sai do chat em origem cruzada e a fila deixa de ter a pendência', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies(await cookiesDaSemeadura());

  const refresh = page.waitForRequest(
    (r) => r.url().endsWith('/auth/refresh') && r.method() === 'POST',
    { timeout: 30_000 },
  );

  await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);

  // 1. O access da página nasce do cookie httpOnly, com o double-submit.
  const pedidoDeRefresh = await refresh;
  const cabecalhosDoRefresh = await pedidoDeRefresh.allHeaders();
  expect(cabecalhosDoRefresh['x-csrf-token'], 'o JS não achou o brabo_csrf').toBeTruthy();
  expect((await pedidoDeRefresh.response())?.status(), 'a api recusou o refresh').toBeLessThan(300);

  const card = page.locator('[data-testid="motivo-da-politica"]');
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  const recusar = card.locator('xpath=following-sibling::div[count(button)>=2][1]/button[2]');

  const decisao = page.waitForRequest(
    (r) => r.url().endsWith(`/sessions/${semeada.sessionId}/actions/${acaoId}/deny`) && r.method() === 'POST',
    { timeout: 30_000 },
  );
  await recusar.click();

  // 2. A decisão atravessou de `:8088` para `:3000` com o Bearer da página.
  const pedidoDeDecisao = await decisao;
  const cabecalhos = await pedidoDeDecisao.allHeaders();
  expect(cabecalhos.origin).toBe(new URL(baseURL ?? '').origin);
  // A api é OUTRA origem — é o que faz disto uma chamada cruzada, com preflight.
  expect(new URL(pedidoDeDecisao.url()).origin).not.toBe(cabecalhos.origin);
  expect(cabecalhos.authorization).toMatch(/^Bearer /);
  // O refresh é httpOnly e tem `Path=/auth`: não pode viajar numa rota de ação.
  expect(cabecalhos.cookie ?? '').not.toContain('brabo_refresh');

  const resposta = await pedidoDeDecisao.response();
  expect(resposta?.status(), 'a api recusou a decisão').toBe(201);
  expect(((await resposta?.json()) as { status?: string }).status).toBe('denied');

  // 3. A fila, pela api: a ação saiu das pendentes.
  await expect
    .poll(() => idsPendentes(token, semeada), {
      message: 'a ação continua pendente na api depois da decisão',
    })
    .not.toContain(acaoId);
});
