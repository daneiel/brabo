# 0006 — Harness de agentes: montagem determinística de contexto

## Contexto

A Fase 3a monta o harness de agentes no `apps/engine` (Elixir/OTP) ANTES de
qualquer agente de produto. O CLAUDE.md lista 5 behaviours; esta primeira
sessão é explicitamente **sem LLM** — só a montagem determinística de
contexto — e implementa 3 deles: **PromptAssembler**, **InstructionFiles** e
**Hooks**. ToolLoop e ContextManager (que tocam LLM via api) ficam para
sessões seguintes.

O engine não tinha nada de prompt/agente/instruções: sem tabela, sem leitor
de arquivos do workspace, sem tokenizer, sem estrutura de hooks. Este ADR
registra as decisões de forma dessa fundação.

## Decisões

### Modelo de camadas + corte determinístico (PromptAssembler)

O prompt é montado em 5 camadas ORDENADAS (identidade → instruction_files →
contexto_projeto → regras_negocio → estado_tarefa), cada uma com um orçamento
de tokens. O `PromptAssembler` é uma função PURA e agnóstica à fonte de dados
(quem coleta é o `ContextBuilder`) — isso mantém o algoritmo, o coração do
critério de aceite, testável isoladamente.

Cada camada declara uma estratégia de corte, aplicada quando estoura o
orçamento — sempre DETERMINÍSTICA e documentada:

- `:drop_whole_units` (camadas de unidades, ex.: regras de negócio) — descarta
  unidades INTEIRAS da cabeça da lista até caber. **Nunca trunca no meio de
  uma unidade.** A lista vem em ordem de descarte: regras de negócio, mais
  antigas primeiro; instruction files, menor precedência primeiro. Uma unidade
  sozinha maior que o orçamento é descartada inteira (camada pode ficar vazia),
  nunca partida.
- `:truncate_tail` (blob, ex.: contexto do projeto) — mantém um prefixo
  dimensionado ao orçamento (respeitando UTF-8) + marcador `[… truncado …]`.
- `:keep_or_drop` (blob, ex.: identidade) — tudo-ou-nada: cabe mantém, não
  cabe descarta a camada inteira (meia identidade é inútil).

Rejeitado: truncar por caractere qualquer camada (perderia a garantia de
"nunca partir uma regra de negócio"). Rejeitado também: um único modo de corte
global — camadas têm naturezas diferentes (lista vs blob vs identidade) e
merecem estratégias diferentes, todas explícitas.

### Estimativa de tokens (Tokenizer)

Sem LLM e sem lib nova (respeita "não instalar libs sem justificar"): a
contagem é uma ESTIMATIVA local por `bytes/4` com teto — a mesma heurística
já usada em `Engine.Actions.TerminalExecutor` (`@bytes_per_token 4`). Todo
resultado é marcado `estimated: true` nas camadas e no relatório. O
`Engine.Harness.Tokenizer` é um behaviour trocável via
`Application.get_env(:engine, :tokenizer, ...Approximate)` — um tokenizer real
pode ser plugado depois sem tocar no assembler.

### InstructionFiles: precedência e cache

Fontes: `AGENTS.md` da raiz do workspace do projeto + `AGENTS.md` de cada
subdiretório (walk recursivo, pula `.git`) + o arquivo do agente no banco
(`agent_instructions`). **Precedência documentada: banco > diretório > raiz**
— e, entre diretórios, o mais profundo (mais específico) vence a raiz. As
fontes são retornadas em ordem CRESCENTE de precedência (raiz primeiro, banco
por último): o banco é lido por último e vence em conflito ("last wins"), e é
essa mesma ordem que o corte usa (descarta o menos autoritativo, a raiz,
primeiro).

Recarga por **invalidação simples, sem watch de fs** (por ora). Cache em ETS:
um processo supervisionado mínimo (`InstructionFiles.Cache`) só cria e detém a
tabela nomeada pública; o IO de fs+banco acontece no processo CHAMADOR de
`load/2` — assim o cache não toca no banco e não colide com o sandbox Ecto nos
testes. `invalidate/2` = `:ets.delete`. É o **primeiro uso de ETS no engine**:
justificado por ser o primitivo padrão de cache do Elixir e por evitar a dor
de um GenServer lendo o banco sob sandbox.

### Hooks: registro funcional puro

`Engine.Harness.Hooks` é um VALOR (map de fase → lista de handlers em ordem de
registro), não um processo — determinístico, testável sem estado global
mutável, casando com o gosto do codebase (sem registries globais além do de
identidade de processo). Fases: `pre_tool_use`, `post_tool_use`,
`session_start`, `session_end`. `run/3` roda os handlers na ordem de registro
(`reduce_while`); um handler que retorna `{:halt, reason}` interrompe a cadeia.
É a base para o pipeline de ações e o executor de terminal plugarem como
handlers numa sessão futura — cada um construindo e rodando o valor de hooks
por invocação.

### Ownership de `agent_instructions`

A tabela referencia `projects` (dado de domínio da api) → é criada por
**migration Drizzle no apps/api** (schema `public`), e o engine só LÊ via um
Ecto schema `@schema_prefix "public"` (`Engine.AgentInstructions.Instruction`),
nunca uma migration própria — migrations do engine vivem só no schema
`engine`. Mesmo padrão de `Engine.Projects.ProjectRepository`/`SessionEvents`.
Nos testes do engine (banco `engine_test`, isolado do banco da api), a tabela
existe via um fixture raw em `test_helper.exs`, igual `outbox_events`/
`session_events`/`project_repositories`.

## Consequências

- As camadas `:regras_negocio` e `:estado_tarefa` saem VAZIAS nesta sessão —
  não há fonte ainda (business_rule é emitido pelo Criativo na Fase 3b; o
  estado da tarefa vem do ToolLoop/agentes). O algoritmo de corte já as trata
  (vazio = 0 tokens) e é exercitado nos testes com unidades sintéticas.
  Inventar tabelas pra elas seria escopo de 3b.
- A identidade do agente é um mapa estático mínimo (`Engine.Harness.Agents`),
  uma linha por slug do roster — não é "implementar um agente" (sem
  comportamento, sem LLM), só conteúdo pra a camada existir.
- Critério de aceite atendido por `Engine.Harness.Debug.print/2` (função de
  debug chamável do IEx, sem Mix.Task — não há precedente no engine), que
  imprime cada camada com sua contagem de tokens (estimada) e o prompt montado.
- Os orçamentos por camada são constantes de módulo com defaults razoáveis,
  sobrescrevíveis via `opts[:budgets]`. Sem LLM ainda, servem pra exercitar o
  corte e dar visibilidade no debug; serão calibrados quando o ToolLoop
  entrar.
