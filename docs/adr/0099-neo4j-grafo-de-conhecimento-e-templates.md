# ADR 0099 — Neo4j como grafo de conhecimento e templates de prompt, driver na api

- **Status:** Aceito
- **Data:** 2026-08-19
- **Contexto:** fundação do grafo de conhecimento (RN-413/414/415), decisão
  do dono do produto de trazer Neo4j para o produto

## Contexto

Dois vãos reais do produto motivaram esta entrega. Primeiro: **nenhum
agente consome o RAG** que já existe (pgvector, busca híbrida vetor+léxico,
`HybridSearchUseCase`) — ele só é usado pela aba web "Chat RAG". Segundo:
**todo prompt de agente é heredoc Elixir inline** — identidades
(`Engine.Harness.Agents`), kickoffs de PO/Arquiteto/Dev Lead/UX/Infra, o
prompt de sumarização do `ContextManager` — nada disso vive fora do
código, versionado ou reutilizável.

O dono do produto pediu Neo4j inspirado no repositório
[`ErickWendel/neo4j-ai-experiments`](https://github.com/ErickWendel/neo4j-ai-experiments),
que usa o grafo como memória de agentes de IA e mantém os prompts em
arquivos separados da lógica da aplicação (diretório `prompts/`, com
templates nomeados para conversão NL→Cypher, contexto e formatação de
resposta). **Este projeto foi a inspiração concreta do padrão adotado
aqui** — vale o agradecimento explícito: sem ele, a forma "prompt como
arquivo versionado, não string presa no código" não teria um precedente
tão direto para seguir.

## Decisão

Neo4j entra como **grafo de conhecimento** — memória DERIVADA do event
log, nunca fonte de verdade — com duas responsabilidades:

1. **Templates de prompt versionados** (`PromptTemplate`/`PromptVersion`),
   substituindo gradualmente os heredocs inline (a migração dos GenServers
   em si é onda futura; esta entrega só constrói a fundação).
2. **Memória relacional**: interações do usuário, hipóteses do Psicólogo
   com evidência (`EVIDENCIA` → `Evento{sessionId,seq}`), perfis de
   proficiência da Anamnese, handoffs entre agentes.

**pgvector CONTINUA sendo o índice vetorial dos chunks** — o grafo não
guarda embedding nenhum. Guardar o mesmo vetor em dois bancos divergiria
na primeira reindexação que só tocasse um dos dois; a decisão foi manter
UMA fonte vetorial e o grafo como camada de RELAÇÃO por cima.

**Driver: `neo4j-driver` (pacote oficial) na `apps/api`, não no engine.**
A api já é dona de TODA persistência do produto (Postgres, pgvector,
`permissions.json`) e do RAG existente; o engine já consome tudo por HTTP
interno com service token, nunca abriu conexão direta a um banco de
domínio. Repetir esse padrão — engine chama rota interna, api fala com o
banco — mantém UMA fronteira de credencial/pool, em vez de duas.

**Esquema mínimo, com constraints de unicidade** (Neo4j Community não tem
NODE KEY composto, só `IS UNIQUE` sobre propriedade única):
`PromptTemplate.name`, `Usuario.id`, `Projeto.id`, `Agente.slug`,
`Interacao.sessionId`. `Hipotese`/`Handoff` usam MERGE por chave natural
própria (id da hipótese; `(sessionId, seq)` do handoff) sem constraint
formal — a idempotência vem do MERGE, não de uma restrição estrutural
adicional.

## Degradação, não crash

`GraphStore.onModuleInit` NUNCA lança. Três variáveis de ambiente
(`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`) são **obrigatórias em
produção** (falha cedo no boot, mesmo espírito do `GIT_OAUTH_STATE_SECRET`
do ADR 0059) e **opcionais fora dela** — ninguém precisa subir um Neo4j
local só para rodar a suite da api. Ausente ou indisponível, o driver fica
`null` e toda operação lança `GraphUnavailableError`, convertido em 503
(nunca 500 cru) pelo filtro global `GraphErrorFilter`, ou em resposta
degradada nos casos de uso que têm fallback (busca RAG sem enriquecimento
de grafo, por exemplo).

## Consequências

- O grafo é reconstruível por replay do event log/outbox (ver Onda 2,
  RN-416) — nunca uma segunda fonte de verdade a manter sincronizada por
  disciplina manual.
- Migração dos kickoffs inline dos GenServers para consumir templates do
  grafo é onda POSTERIOR, declarada fora desta entrega — esta ADR só
  estabelece que o mecanismo existe e é seguro de introduzir aos poucos.
- Consequência aceita e nova para o produto: é a primeira dependência de
  infraestrutura que não é Postgres nem Ollama. O `docker-compose.yml`
  ganha um serviço a mais para quem roda `pnpm dev` local, com heap
  limitado (a máquina de dev de referência tem 15 GB, já dividida entre
  Postgres, Ollama, api, engine e web).
