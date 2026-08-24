# ADR 0101 — Memória relacional como projeção do event log; templates consumidos sem tocar GenServers

- **Status:** Aceito
- **Data:** 2026-08-20
- **Contexto:** consumo da fundação do grafo (RN-416/417), companheira dos
  [ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)/
  [ADR 0100](0100-rag-search-e-modelos-garantidos-no-boot.md)

## Contexto

A onda anterior construiu a fundação do grafo (Neo4j, templates
versionados, `rag_search`) sem consumidor real. Esta onda liga os dois
lados: (1) três agentes passam a resolver o kickoff/identidade a partir
de um template do grafo, com fallback para o texto inline; (2) Psicólogo
e Anamnese passam a compor "N mais recentes"/"janela temporal" com
trechos RELEVANTES do projeto via `rag_search`; (3) o grafo passa a se
escrever sozinho, por projeção do event log.

Duas perguntas de desenho precisavam de resposta ANTES de paralelizar:
como consumir templates sem reescrever os GenServers inteiros, e como
escrever no grafo sem abrir um segundo caminho de escrita a partir do
engine.

## Decisão

**Templates: `InstructionFiles` ganha fonte `:graph`, sem mudar contrato.**
Precedência final: **`db > graph > dir > root`** — o `instruction_patch`
do usuário continua vencendo tudo (regra de negócio já estabelecida:
usuário sempre pode sobrescrever); o grafo vence o que está em disco.
`PromptAssembler` não muda; nenhum GenServer de agente perde uma linha de
lógica — cada um só passa a TENTAR resolver o template antes de usar o
texto inline, que vira o fallback. Cache ETS reusado (nenhum cache
paralelo novo), TTL curto.

Duas flags, deliberadamente SEPARADAS: `graph_templates_enabled?`
(Psicólogo + Anamnese, mesma chave, mesmo consumidor de kickoff) e
`graph_instruction_templates_enabled?` (ux-designer, via
`InstructionFiles`). Uma chave só colidiria com defaults CONTRÁRIOS entre
as duas frentes que as escreveram em paralelo — e a resolução de
`config/2` do Elixir com chave duplicada fica com a ÚLTIMA ocorrência,
silenciando uma das duas SEM ERRO NENHUM. Duas chaves com nomes
inconfundíveis é mais barato que coordenar um valor único entre frentes
paralelas. Os dois defaults são `false`: capacidade nova nasce desligada
até o seed rodar e alguém ativar deliberadamente — mesmo critério de
`psychologist_enabled?`/`anamnese_enabled?`.

**Relevância: composição, nunca substituição.** Psicólogo e Anamnese
continuam lendo o que sempre leram (eventos recentes / janela temporal) e
GANHAM uma segunda fonte, `rag_search`, com uma query derivada do
GATILHO da análise (causa de término classificada, no Psicólogo;
competências sem perfil ainda, na Anamnese — nunca texto livre de
hipótese/hesitação, pela proibição já estabelecida de a Anamnese nunca
inferir saúde/personalidade/idade/gênero). Os tetos existentes de
`Triage` (`max_prompt_events`, `max_payload_chars`) CONTINUAM sendo o
orçamento total — os trechos relevantes descontam vagas da janela de
recentes, nunca somam por fora. `degraded: true` do RAG aparece
explicitamente no contexto montado, nos dois agentes — nunca escondido.
Falha do RAG é estritamente aditiva: sem hit, o comportamento é
IDÊNTICO ao de antes desta onda (é o que manteve os ~50 testes
pré-existentes verdes sem tocar um só).

**Memória relacional: projeção da OUTBOX existente, aggregate_type
próprio.** A alternativa óbvia — o engine escrever no grafo direto —
foi descartada: abriria um SEGUNDO caminho de escrita além do event log,
quebrando a garantia de que o event log é a única fonte de verdade. A
alternativa de reusar o `aggregateType: 'session'` que a outbox já tem
também foi descartada: o `Engine.Outbox.Drain` do lado engine já drena
esse tipo a cada ~2s e marca `processed_at` — um consumidor do lado api
correndo contra o mesmo tipo perderia a corrida quase sempre. A decisão:
uma SEGUNDA linha de outbox, mesma transação, `aggregateType:
'graph_projection'` — valor que o filtro do engine (`IN ('session',
'task')`) nunca casa, mesmo padrão que `deny-action.use-case.ts` já usa
pra gravar em dois `aggregateType` na mesma transação. `GraphProjector`
(poller, ~2s, mesmo formato do `DomainGaugesCollector`) drena essa fila e
chama os casos de uso de gravação já existentes (`RecordHandoff`,
`RecordHypothesis`, `RecordAnamneseProfile`, `RecordInteraction`) — a
idempotência mora NELES, o projector não duplica a lógica.

## Consequências

- O grafo continua reconstruível por replay: `graph_projection` é uma
  fila DERIVADA do event log, nunca uma segunda gravação primária —
  perder o Neo4j e recriar do zero é replay, não perda de dado.
- `GraphUnavailableError` no meio de um lote PARA o ciclo inteiro (não
  tenta o resto do lote, que falharia pelo mesmo motivo) — a linha fica
  não-processada e tenta de novo no próximo ciclo. Retry é automático,
  sem intervenção.
- Consumo declarado FORA desta entrega, mesmo padrão de honestidade dos
  ADRs anteriores: `query_user_context` (hipóteses com evidência + perfis
  do grafo) continua sem rota HTTP exposta — Psicólogo/Anamnese ainda não
  LEEM do grafo, só o RAG (pgvector) via `rag_search`; só
  `psychologist.hypothesis_proposed` é projetado (não `accepted`/
  `dismissed`); `context-manager-summarize` é o único dos quatro
  templates da primeira leva ainda não consumido por nenhum agente.
- As duas flags (`graph_templates_enabled?`,
  `graph_instruction_templates_enabled?`) continuam `false` em todo
  ambiente até alguém rodar o seeder e ativar deliberadamente — esta
  entrega não muda comportamento observável em produção por si só.
