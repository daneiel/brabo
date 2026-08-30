import { expect, test } from '@playwright/test';
import { autenticar, semearSessao, type SessaoSemeada } from '../suporte/api.ts';

/**
 * O ticket do socket da sessão (RN-108) num navegador de verdade.
 *
 * A regra: o canal `session:<id>` do Phoenix exige um ticket opaco de uso
 * único (TTL de 30s), obtido em `POST .../socket-ticket` — NÃO o JWT
 * reaproveitado. Provar isso exige as três coisas juntas, e nenhuma existe
 * em jsdom:
 *
 * 1. o pedido do ticket sai da web para a api em ORIGEM CRUZADA, com o
 *    cookie e o `X-CSRF-Token` que só um browser monta;
 * 2. o handshake do WebSocket sobe de fato contra o engine, numa TERCEIRA
 *    origem (`:4000`);
 * 3. o ticket viaja na query do socket, que é onde o `connect/3` o lê.
 *
 * A asserção é sobre o WebSocket OBSERVADO (`page.on('websocket')`), não
 * sobre um texto de status na tela: o que se quer provar é o mecanismo, e
 * um indicador de "conectado" pode mudar de cor, de rótulo ou de idioma sem
 * que o socket mude nada.
 *
 * Este spec NÃO passa pelo formulário de login: ele nasce com o estado que o
 * projeto `setup` guardou, e o access é reconstruído do cookie no primeiro
 * carregamento. O motivo está em `suporte/entrar.setup.ts` — é o lockout por
 * IP do produto, não conveniência.
 */

let semeada: SessaoSemeada;

test.beforeAll(async () => {
  const token = await autenticar();
  semeada = await semearSessao(token);
});

test('o canal da sessão sobe com ticket na query, e o refresh não vai junto', async ({ page }) => {
  // Um socket pode subir antes do `await` da navegação retornar, então o
  // ouvinte é registrado ANTES de qualquer goto.
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));

  const pedidoDeTicket = page.waitForResponse(
    (r) => r.url().includes(`/sessions/${semeada.sessionId}/socket-ticket`) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );

  await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);

  const resposta = await pedidoDeTicket;
  expect(resposta.status(), 'a api recusou emitir o ticket').toBe(201);

  await expect
    .poll(() => sockets.filter((url) => url.includes('/socket/websocket')).length, {
      message: 'nenhum WebSocket foi aberto contra o engine',
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  const doSocket = sockets.find((url) => url.includes('/socket/websocket'));
  expect(doSocket, 'socket do engine não encontrado').toBeDefined();

  // O ticket vai na query porque é lá que o `connect/3` do Phoenix lê os
  // params. Se um dia ele voltar a viajar como JWT, esta linha é a que cai.
  expect(doSocket).toContain('ticket=');

  // E o que NÃO pode estar lá: o refresh é httpOnly justamente para nunca
  // chegar a uma URL, onde ele acabaria em log de servidor e de proxy.
  expect(doSocket).not.toContain('brabo_refresh');
});
