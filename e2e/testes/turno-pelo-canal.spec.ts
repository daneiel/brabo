import { expect, test, type WebSocket } from '@playwright/test';
import {
  autenticar,
  cookiesDeUmLoginProprio,
  semearSessaoSemCredencial,
  type SessaoSemCredencial,
} from '../suporte/api.ts';

/**
 * O CICLO de um turno de agente chegando pelo canal `session:<id>`, numa
 * TERCEIRA origem (o engine, `:4000`), com a página em `:8088` (AT-338).
 *
 * O turno é um que FALHA por falta de credencial — decisão do dono: sem LLM e
 * sem custo. O Criativo sobe, pede o modelo à api, e a api responde no frame
 * final `Nenhuma credencial cadastrada para <provider>` (RN-058: a chave é a
 * do DONO do workspace, e ele não tem uma para aquele provider). O engine a
 * transforma em `agent.error` com origem `politica`
 * (`Engine.Agents.FalhaDeTurno`, RN-059), entre `agent.status: working` e
 * `agent.status: idle` (`TurnoAssincrono`). Por que o workspace precisa de um
 * modelo vinculado, e de qual, está em `semearSessaoSemCredencial`.
 *
 * O que só este nível prova: que esses TRÊS eventos atravessam o WebSocket
 * real que a página abriu com o ticket de uso único (RN-108), na ordem, e que
 * a tela os consome — a bolha de falha aparece com a origem que o engine
 * gravou. A asserção é sobre os FRAMES observados (`framereceived`) e sobre um
 * seletor estrutural (`data-testid`/`data-origem`), nunca sobre texto de tela.
 *
 * O que NÃO prova, e não se chama de streaming: o `agent.delta`, que só um
 * provider de verdade emite (ver "O que NÃO está coberto" no README).
 *
 * Sessão de navegador própria (`cookiesDeUmLoginProprio`): o estado do `setup`
 * é de `socket-da-sessao.spec.ts` e os cookies da semeadura são de
 * `aprovacao-inline.spec.ts`, cada um válido uma vez. Custa um login a mais do
 * balde do lockout, contado no README.
 */

test.use({ storageState: { cookies: [], origins: [] } });

let semeada: SessaoSemCredencial;

test.beforeAll(async () => {
  const token = await autenticar();
  semeada = await semearSessaoSemCredencial(token);
});

interface FrameDoCanal {
  topico: string;
  evento: string;
  carga: Record<string, unknown>;
}

/**
 * Um frame do Phoenix: o serializador v2 manda `[join_ref, ref, topic, event,
 * payload]`; o v1, um objeto. Qualquer outra coisa (binário, heartbeat
 * malformado) não é deste canal.
 */
function lerFrame(bruto: string | Buffer): FrameDoCanal | null {
  if (typeof bruto !== 'string') return null;
  let dado: unknown;
  try {
    dado = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (Array.isArray(dado) && dado.length === 5) {
    const [, , topico, evento, carga] = dado as [unknown, unknown, unknown, unknown, unknown];
    if (typeof topico !== 'string' || typeof evento !== 'string') return null;
    return { topico, evento, carga: (carga ?? {}) as Record<string, unknown> };
  }
  if (dado && typeof dado === 'object') {
    const o = dado as { topic?: unknown; event?: unknown; payload?: unknown };
    if (typeof o.topic !== 'string' || typeof o.event !== 'string') return null;
    return { topico: o.topic, evento: o.event, carga: (o.payload ?? {}) as Record<string, unknown> };
  }
  return null;
}

test('o turno sobe, falha por credencial e o desfecho chega pelo canal da sessão', async ({
  page,
  context,
}) => {
  await context.addCookies(await cookiesDeUmLoginProprio());

  const topico = `session:${semeada.sessionId}`;
  const frames: FrameDoCanal[] = [];
  // Registrado ANTES do goto: o socket pode subir antes de a navegação voltar.
  page.on('websocket', (ws: WebSocket) => {
    if (!ws.url().includes('/socket/websocket')) return;
    ws.on('framereceived', ({ payload }) => {
      const frame = lerFrame(payload);
      if (frame && frame.topico === topico) frames.push(frame);
    });
  });

  await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);

  // 1. O join do canal da sessão foi CONFIRMADO pelo engine. Sem isso, um
  //    broadcast emitido antes do join se perde e o spec mediria a corrida,
  //    não o canal.
  await expect
    .poll(
      () =>
        frames.some(
          (f) => f.evento === 'phx_reply' && (f.carga as { status?: unknown }).status === 'ok',
        ),
      { message: `o engine não confirmou o join de ${topico}`, timeout: 30_000 },
    )
    .toBe(true);

  // 2. O composer da sessão criativa: o Criativo é o destinatário único, e o
  //    `value` do seletor é o SLUG — estrutura, não rótulo traduzido.
  const destinatario = page.locator('[data-testid="destinatario-do-chat"]');
  await expect(destinatario.locator('select')).toHaveValue('criativo', { timeout: 30_000 });
  const composer = destinatario.locator('xpath=following-sibling::div[1]');
  await composer.locator('textarea').fill('Quero um app de receitas.');
  const enviar = composer.locator('button').first();
  await expect(enviar).toBeEnabled();

  const aceite = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/sessions/${semeada.sessionId}/agents/criativo/message`) &&
      r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await enviar.click();
  // ADR 0163: o POST responde no ACEITE; o desfecho vem pelo canal.
  expect((await aceite).status(), 'a api recusou a mensagem').toBeLessThan(300);

  // 3. working → agent.error (politica, sem credencial) → idle, pelo socket.
  const indice = (pred: (f: FrameDoCanal) => boolean, depois = -1) =>
    frames.findIndex((f, i) => i > depois && pred(f));
  const ehStatus = (status: string) => (f: FrameDoCanal) =>
    f.evento === 'agent.status' && f.carga.status === status;
  const ehErro = (f: FrameDoCanal) => f.evento === 'agent.error';

  await expect
    .poll(
      () => {
        const trabalhando = indice(ehStatus('working'));
        const erro = indice(ehErro, trabalhando);
        const livre = indice(ehStatus('idle'), erro);
        return trabalhando >= 0 && erro >= 0 && livre >= 0;
      },
      {
        message: `working → agent.error → idle não chegaram pelo canal; recebido: ${JSON.stringify(
          frames.map((f) => f.evento),
        )}`,
        timeout: 45_000,
      },
    )
    .toBe(true);

  const erro = frames[indice(ehErro, indice(ehStatus('working')))];
  expect(erro?.carga.origem, 'origem do agent.error').toBe('politica');
  // O texto é o que a API narrou no frame final (pt-BR no produto, fora do
  // idioma da interface) — é conteúdo do payload, não seletor de tela.
  expect(String(erro?.carga.mensagem)).toContain('Nenhuma credencial cadastrada');
  expect(String(erro?.carga.mensagem)).toContain(semeada.provider);

  // 4. A tela consumiu o desfecho: a bolha de falha, com a origem gravada.
  await expect(
    page.locator('[data-testid="falha-de-turno"][data-origem="politica"]'),
  ).toBeVisible({ timeout: 30_000 });
});
