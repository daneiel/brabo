---
paths:
  - "apps/web/**"
  - "apps/runner/src/channel.ts"
  - "apps/api/src/**/session-channel*"
---

## Socket da sessão, orçamento de requisições e streaming (movido de convencoes-agentes-e-telas.md)

- Socket Phoenix da sessão (`session:<id>`) exige ticket opaco de uso
  único (TTL de 30s, `POST .../sessions/:sessionId/socket-ticket`) em
  `connect/3` — NÃO o JWT reaproveitado. O engine consome o ticket lendo
  `session_socket_tickets` direto (mesmo padrão de `outbox_events`);
  reconexão, inclusive automática, sempre busca ticket novo (RN-108).
  A consequência prática vale para TODO construtor de `Socket` do
  repositório, o do `/runner` inclusive: o auto-reconnect embutido do
  `phoenix.js` repete os MESMOS `params`, então ele é NEUTRALIZADO na
  construção (`reconnectAfterMs: () => NUNCA_RECONECTAR_SOZINHO_MS`, 24h) e a
  reconexão é sempre a política PRÓPRIA do módulo, com ticket fresco. Isso já
  falhou em DOIS dos quatro (`apps/runner/src/channel.ts` e
  `apps/web/src/lib/fs-browser-channel.ts`), e no runner o docblock AFIRMAVA a
  neutralização que o código não fazia — 530 req/min contra o teto de 300 do
  `RATE_LIMIT_USER`, com o 429 aparecendo no navegador do usuário dono da
  conta. Por isso a opção é OBRIGATÓRIA no tipo (`OpcoesDoSocket` do runner) e
  é asserida por teste sobre a OPÇÃO passada ao construtor: teste que só
  verifica "conecta" passa com o defeito de pé, e passou. Comentário não é
  mecanismo. No web, nenhum arquivo chama `new Socket` direto: todo socket nasce por
  `criarSocket` (`apps/web/src/lib/socket-phoenix.ts`) e morre por `descartar()`,
  porque o construtor do `phoenix@1.8.9` registra três ouvintes em `window` que
  `disconnect()` não remove; e o canal da sessão é por GERAÇÃO — callback de
  socket substituído não age (RN-833).
- O teto de 300 req/min é do USUÁRIO, não da aba, e NÃO se resolve subindo o
  teto (RN-579, AT-093: um navegador na Sessão fazia 118/min de mediana e 263
  de pico). Com o canal `session:<id>` VIVO (join confirmado), as queries da
  sessão pollam no fallback de 15s (30s o orçamento) e quem diz QUANDO buscar
  é o `event.appended` — que a fachada `EngineApiClient` emite para TODA
  escrita que a api confirmou, só com `type`/`actorId`. Query nova de sessão
  passa por `intervaloDaSessao` (`apps/web/src/lib/canal-vivo.ts`), senão um
  único observador em 3s segura a chave inteira em 3s; invalidação pelo canal
  passa por `criarInvalidadorDoCanal`, que tem janela por alvo — invalidar por
  aviso SEM janela só troca poll por rajada. O número é guardado por
  `canal-vivo.orcamento.test.tsx` (uma aba: 123/min caído, 46 vivo). Leitura
  de PROJETO (lista de sessões, contadores do trilho) nenhum canal avisa, e
  polla no ritmo de projeto, `INTERVALO_DO_PROJETO_MS` (15s, incondicional);
  quem só precisa do dado no CLIQUE não polla (`useLatestSession(id, false)`,
  as linhas de `/containers`); e TODA tela que ouve `session:<id>` — não só a
  de Sessão: Executores e Visão geral também — passa pelo MESMO
  `criarInvalidadorDoCanal` (RN-632, AT-278: a aba Executores fazia 630 GET de
  eventos/min com um dev agent em rajada). O número de DUAS abas, com as telas
  de verdade, é guardado por `duas-abas.orcamento.test.tsx`. Dado de
  CONFIGURAÇÃO (as seções de Configurações, o workspace/papel) nasce com
  `staleTime: FRESCOR_DA_CONFIGURACAO_MS` (`query-policy.ts`, um minuto) e sem
  poll (RN-645, AT-321): com `staleTime: 0` cada seção que montava depois da
  moldura refazia a busca dela, e voltar à aba refazia 31. Estado operacional
  (container, gasto, `lastUsedAt`) fica fora, com o default. Os bindings
  RESOLVIDOS de agentes e áreas vêm num LOTE só
  (`GET .../model-bindings/resolved`, RN-654), sob UMA `queryKey` que as três
  seções de modelo, a Visão geral e a aba Executores leem (os `dev-<modulo>`
  fora do catálogo numa leitura em lote a mais, sob o mesmo prefixo, AT-339) —
  não volte a uma query por chave. Guardado por
  `configuracoes.orcamento.test.tsx`. Escrita
  que NÃO passa pelo engine (humano noutra aba, transição feita pela api)
  também avisa desde a AT-157: a api pede ao engine
  `POST /internal/sessions/:id/event-appended` DEPOIS do commit
  (`SessionChannelNotifier`, `aposCommit`), e não pede para escrita vinda do
  engine (`/internal/*`), que a fachada já avisou. É melhor esforço: o aviso
  perdido cai no fallback de 15s. Caso de uso novo que grave em
  `session_events` sem `AppendSessionEventUseCase` chama o notifier. E 304 não reduz a contagem do rate limit —
  o guard conta antes do handler —, mas corpo `null` agora tem `ETag`
  (`etag-do-corpo-vazio.ts`): sem ele, a rota que responde vazio nunca
  voltava 304. A leitura de 4s da cauda que acompanha um turno aceito
  (RN-578) NÃO vira fallback de 15s: ela é a rede contra o `agent.done`
  perdido, e o aviso pode se perder junto; o que o canal faz é ANTECIPÁ-LA
  (`avisoPedeVerificacaoDoTurno`, só o `agent.status` do agente acompanhado).
- O que muda por TOKEN não mora no estado da `SessionPage` (RN-639, AT-301):
  o texto em curso e a faixa de atividade ficam no store de
  `lib/streaming-do-turno.ts`, assinado por `useSyncExternalStore` só por quem
  os desenha (a bolha em `SessionFio.tsx`, `TurnActivityStripDoStore`), e a
  página assina booleanos. Estado novo de streaming entra no store, nunca num
  `useState` do `useTurnoDoAgente` — `SessionPage.streaming-isolado.test.tsx`
  conta os renders da página e reprova o token que a re-renderiza.
