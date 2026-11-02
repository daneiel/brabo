# ADR 0100 — `rag_search` para agentes e modelos Ollama garantidos no boot

- **Status:** Aceito
- **Data:** 2026-08-20
- **Contexto:** fundação do grafo de conhecimento (RN-413/414/415),
  companheira do [ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)

## Contexto

O RAG (pgvector, busca híbrida vetor+léxico, ADR 0079/0080/0082) existe
por completo na api desde a Onda 4/frente G2 do Programa 28 — mas
`grep -rn "rag" apps/engine/lib` dava ZERO ocorrências até esta entrega.
**Nenhum agente jamais consultou o RAG do próprio projeto.** É o maior
vão do desenho atual: o produto constrói um índice e só a aba web "Chat
RAG" o lê.

Segundo achado, também real e não desta feature: `nomic-embed-text`
(`RAG_EMBEDDING_MODEL` em `rag-search-limits.ts`) **nunca é puxado
automaticamente**. O entrypoint do serviço `ollama` no `docker-compose.yml`
só puxa `llama3.2:1b`. Em qualquer ambiente limpo, o RAG degrada
silenciosamente para busca léxico-only até alguém rodar
`ollama pull nomic-embed-text` manualmente — ninguém tinha notado porque
o produto nunca tinha, até agora, um consumidor programático da busca que
tornasse a degradação visível cedo.

## Decisão

**Tool nova `rag_search`** (`apps/engine/lib/engine/harness/tools/rag_search.ex`),
categoria `:direct` (leitura, não passa por `ActionPipeline`/
`proposed_action` — ler não é efeito externo, regra já estabelecida).
Chama `POST /internal/rag/search` (rota nova da api, reusando
`HybridSearchUseCase` sem duplicar lógica de busca) e formata os hits com
CITAÇÃO explícita (`path` + trecho), para o modelo poder referenciar a
origem do que leu. Quando a resposta vem `degraded: true` (embedding
indisponível, busca caiu para léxico-only), isso aparece **no início** do
texto devolvido ao modelo — nunca escondido no rodapé, onde um corte por
teto de bytes poderia apagar o aviso.

**Tetos próprios**, no espírito da RN-150 (cada ferramenta de leitura que
pode estourar tem sua PRÓPRIA variável, nunca reaproveitada de outra):
`top_k` clampado a um máximo (10) dentro da própria tool, e um teto de
BYTES do texto formatado (16 KiB, menor que os 32 KiB de
`search_workspace`/`read_file` — cada hit de RAG já é chunk+excerpt
inteiro, acumula bytes mais rápido por item).

Registrada no registry default (`Engine.Harness.Tools`, serve
PO/Arquiteto/conversacionais) e no registry do dev agent
(`Engine.Dev.Tools`). Estendida também aos gates de leitura que já citam
ADR/convenção indexada (`QaTools`, `QaEstrategiaAgent`, `AppSecAgent`,
`QaPerformanceSegurancaAgent`) — não a `Infra.WorkflowsAgent` (deliberadamente
estreito, sem `ReadFile`/`SearchWorkspace` hoje) nem a
Psicólogo/Anamnese (raciocinam sobre event log, não sobre docs/código do
projeto).

**`ollama-model-loader`**: serviço one-shot novo no `docker-compose.yml`
(dev e prod), que puxa `gemma:1b`, `yi-coder:1.5b` e `nomic-embed-text`
via `OLLAMA_REQUIRED_MODELS` — aditivo ao serviço `ollama` existente
(cujo entrypoint continua puxando `llama3.2:1b` para o próprio uso do
engine, intocado). Fecha o bug real de `nomic-embed-text` nunca chegar
sozinho, não só a necessidade desta feature.

## Consequências

- A capability do RAG para agentes é declarada só quando exercitada — o
  roundtrip real contra `POST /internal/rag/search` depende da rota da
  api estar de pé; a tool degrada com erro legível ao modelo (nunca
  crasha o `ToolLoop`, RN-163) quando a api está fora do ar.
- `deploy/k8s/` ganha manifests mínimos para Neo4j e o model-loader,
  DECLARADOS como não validados contra um cluster real (a mesma
  disciplina do resto do `deploy/k8s/`: capability só é declarada quando
  provada).
- O custo de embedding de `rag_search` não passa pelo metering ainda —
  mesma lacuna já declarada no ADR 0075 para o RAG em geral
  (`token_usage.session_id` é `NOT NULL`, indexar não acontece dentro de
  sessão).
