# 0082 — Chat RAG: aba própria de busca híbrida, sem renomear "Chat"

## Status

Aceito.

## Contexto

O [ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md) (PROGRAMA 28,
Onda 4, frente G2) deixou o pipeline de indexação e as três rotas HTTP do
Chat RAG prontas — `POST .../rag/search`, `POST .../rag/reindex`,
`GET .../rag/coverage` — mas declarou explicitamente que a TELA era
trabalho da Onda 5. Enquanto isso, o [ADR 0078](0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
(RN-202) tinha decidido que a aba `sessions` continuaria rotulada "Chat",
nunca "Chat RAG" como o handoff mais recente pede — porque, naquele
momento, "Chat RAG" descrevia uma capacidade que o produto não tinha
(sem pipeline, sem UI de citação). Esta frente (Onda 5, G3) é o momento
em que essa capacidade passa a existir de verdade, e a pergunta que ela
precisa responder é: agora que RAG existe, o rótulo "Chat RAG" vai para
onde?

Duas opções: renomear `sessions` para "Chat RAG" (o que o handoff
literalmente sugere), ou dar a "Chat RAG" uma aba PRÓPRIA. As duas
telas respondem perguntas estruturalmente diferentes — `sessions` é
conversa com um agente ATIVADO, que gasta a chave do owner por turno
(RN-058) e pode escrever no backlog, no código, em qualquer ferramenta
que o agente tenha; RAG é busca sobre um ÍNDICE já construído, sem
agente nenhum no meio, e read-only por natureza (as três rotas do ADR
0080 são `viewer`/`viewer`/`maintainer`, nenhuma delas invoca um LLM de
conversa). Fundir as duas na mesma aba obrigaria a UI a expressar "isto
é uma citação de um chunk indexado" e "isto é a fala de um agente" no
mesmo fio, quando o usuário nunca pediu as duas coisas ao mesmo tempo.

## Decisão

**"Chat RAG" vira aba própria, `key: 'rag'`, sem tocar o rótulo de
`sessions`.** A RN-202 continua válida como estava — `sessions` nunca
foi "Chat RAG", e continua não sendo — mas a razão dela muda de "a
capacidade não existe" para "a capacidade existe em OUTRO lugar". A aba
entra em `apps/web/src/routes/project-tabs.ts` (`ordem: 28`, logo depois
de `code` e antes de `backlog`) — a mesma vizinhança de "olhar o que já
foi produzido/indexado" que a aba Código ocupa, e antes do Backlog, que
é onde a produção nova nasce.

**A tela consome os três contratos do ADR 0080 sem adivinhar forma**
(`apps/web/src/lib/api-client.ts`/`api-types.ts` ganham `searchRag`/
`getRagCoverage`/`reindexRag` e os tipos espelhados 1:1 do DTO —
`RagSearchHit`, `RagChunkOrigin` como união discriminada por `kind`,
`RagCoverage`). A UI tem três peças:

1. `RagCoveragePanel` — contagem REAL de `docs`/`adr`/sessões indexadas
   contra o total real, e `chunksTotal`/`chunksWithoutVector`. Nenhum
   "reindexado há Xmin": a resposta do backend não carrega esse dado
   desde o ADR 0080, e não é esta tela que vai inventá-lo (RN-252).
2. Busca com filtro de escopo (pills `docs`/`adr`/`session`, ausência =
   todos) e um aviso quando `vectorAvailable: false` — "busca só por
   palavra-chave — embedding indisponível", com o motivo quando o
   backend o der (RN-252, a mesma degradação honesta da RN-233 chegando
   à UI).
3. `RagCitationCard` — a citação com score combinado e os dois sinais
   separados (`null` quando o sinal não achou o chunk, nunca 0%,
   preservando a distinção do ADR 0080). Origem `file` mostra
   caminho/`headingPath` como texto; origem `session` navega até o
   EVENTO exato via `useNavigate` + `search: { highlightEvent }` — a
   MESMA rota e o mesmo parâmetro que os chips de evidência do
   Psicólogo já usam (`HypothesisCard.tsx`, Fase 4b) — reuso, não um
   segundo caminho de navegação (RN-253).

**O botão "Reindexar agora" só aparece para `owner`/`maintainer`**,
espelhando no cliente a régua que a rota já aplica (RN-238) — mesmo
padrão de `useCurrentWorkspaceWithRole` que `ProjectSettingsTab`/
`ProjectApprovalsTab` já usam para outros gates de `maintainer` (RN-254).
Quem não tem o papel simplesmente não vê o botão, em vez de vê-lo
desabilitado: reindexar dispara N chamadas ao repositório do projeto e
ao provider de embedding, a mesma régua "muda o que o produto gasta sem
perguntar" do teto de paralelismo de área (RN-083).

## Consequências

**A promessa que a RN-202 tinha adiado chega, mas não do jeito que o
handoff desenhou.** O handoff renomeia uma aba existente; o produto abre
uma nova. É a decisão mais defensável dado que as duas telas nunca
tiveram a mesma pergunta — e o custo de estar errado (uma aba a mais no
registro) é menor que o custo de misturar conversa-com-agente e
busca-sobre-índice na mesma superfície.

**Nenhum deep-link por caminho para a aba Código.** Uma citação de
origem `file` mostra `sourcePath`/`headingPath` como texto simples, sem
navegar — a aba Código (FASE 26/26b) não tem hoje mecanismo de abrir num
arquivo específico via rota/`search`, e construir esse mecanismo é fora
do escopo desta frente. Fica declarado, não meio-implementado: o texto
mostra o caminho real, só não é clicável.

**O gate de `maintainer` no cliente é só UX.** Quem garante que
`reindex` não roda sem o papel continua sendo a api (`RequireRole`,
RN-238) — a tela só evita o clique que a api recusaria de qualquer
forma. Isto segue o mesmo padrão de todos os outros gates de UI do
produto (auto mode, teto de paralelismo, modelo de área): nenhum deles
substitui a checagem do servidor.
