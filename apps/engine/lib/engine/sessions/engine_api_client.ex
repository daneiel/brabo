defmodule Engine.Sessions.EngineApiClient do
  @moduledoc """
  Contrato pros callbacks engine -> api. Trocável em teste via
  `Application.get_env(:engine, :engine_api_client, ...)`, sem Mox.
  """

  @callback report_termination(
              project_id :: String.t(),
              session_id :: String.t(),
              reason :: String.t(),
              to :: String.t()
            ) ::
              :ok | {:error, term()}

  @callback append_event(
              project_id :: String.t(),
              session_id :: String.t(),
              event :: map()
            ) ::
              :ok | {:error, term()}

  @doc """
  Igual `append_event`, mas devolve o evento criado (`%{"id" => ..., "seq"
  => ...}`) — usado quando o chamador precisa do id do artefato (ex.: o
  Criativo referenciar o product_brief no handoff).
  """
  @callback append_event_returning(
              project_id :: String.t(),
              session_id :: String.t(),
              event :: map()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Lê os eventos da sessão (engine -> api, endpoint interno) — usado só pra
  REHIDRATAR o histórico de conversa de um agente no restart. Retorna
  `{:ok, [event_map]}` em ordem de seq.
  """
  @callback list_events(project_id :: String.t(), session_id :: String.t()) ::
              {:ok, [map()]} | {:error, term()}

  @doc """
  Turno de LLM STREAMADO pros agentes conversacionais (Criativo). Consome a
  SSE da api chamando `on_delta.(text)` por delta de texto; retorna
  `{:ok, %{"message" => ..., "usage" => ...}}` (turno completo acumulado) ou
  `{:error, term}`. `on_delta` é livre pra rebroadcastar (ex.: canal Phoenix).
  """
  @callback llm_turn_stream(
              project_id :: String.t(),
              session_id :: String.t(),
              agent :: String.t(),
              messages :: [map()],
              tools :: [map()],
              on_delta :: (String.t() -> any())
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  A sessão tem trabalho pendente que impeça encerrá-la por heartbeat?

  Fechar sessão é sobre o TRABALHO ter acabado, não sobre quem está olhando. O
  timeout de 30s matava a sessão assim que a aba saía da tela — e numa execução
  real deixou um handoff `offered` para o Arquiteto preso numa sessão fechada,
  com épico e quatro histórias prontos e a cadeia sem como seguir.
  """
  @callback session_pending_work(session_id :: String.t()) ::
              {:ok, %{pending: boolean(), motivo: String.t() | nil}} | {:error, term()}

  @doc """
  O remoto de trabalho de um projeto (ADR 0056): `%{kind, origin, default_branch,
  token, username}`.

  O engine não tem a chave mestra e não deve ter — quem decifra é a api. Quem
  consome o `token` injeta por invocação e NUNCA o escreve em arquivo; ver
  `Engine.Actions.GitAuth`.
  """
  @callback get_git_remote(project_id :: String.t()) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Cria um handoff (offered) na api — o Criativo oferece ao PO ao emitir o
  product_brief. Retorna `{:ok, handoff_map}` ou `{:error, term}`.
  """
  @callback create_handoff(
              project_id :: String.t(),
              session_id :: String.t(),
              from_agent :: String.t(),
              to_agent :: String.t(),
              artifact_id :: String.t() | nil
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Ferramentas do PO (create_epic/create_story/create_task) — criam linhas de
  backlog na api (nunca SQL direto). `fields` é o corpo camelCase da linha;
  retornam `{:ok, %{"id" => ...}}` (a story também traz `"status"`) ou
  `{:error, term}` (ex.: business_rule_id inválido → 4xx da api).
  """
  @callback create_epic(project_id :: String.t(), session_id :: String.t(), fields :: map()) ::
              {:ok, map()} | {:error, term()}
  @callback create_story(project_id :: String.t(), session_id :: String.t(), fields :: map()) ::
              {:ok, map()} | {:error, term()}
  @callback create_task(project_id :: String.t(), session_id :: String.t(), fields :: map()) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Ferramentas de LEITURA do PO (RN-164) — as três escopadas ao PROJETO, não à
  sessão: regra de negócio, backlog e métricas de produto atravessam as
  sessões, e limitar a leitura à sessão corrente é justamente o que fazia o
  PO não enxergar o que já existia.

  `list_business_rules/1` devolve `%{"rules" => [...], "uncoveredCount" => n}`;
  `list_backlog/1` devolve a árvore épico → história → tarefa;
  `list_product_metrics/1` devolve o relatório de funil/DORA parcial (ADR
  0089, RN-407) — o MESMO shape do `Relatorio` de `analise-funil.ts`, sem
  campo para as três ausências permanentes (a ferramenta do PO as declara no
  TEXTO, não no JSON). Nenhuma das três leva `session_id` — não há o que
  escopar por sessão aqui.
  """
  @callback list_business_rules(project_id :: String.t()) ::
              {:ok, map()} | {:error, term()}
  @callback list_backlog(project_id :: String.t()) ::
              {:ok, [map()]} | {:error, term()}
  @callback list_product_metrics(project_id :: String.t()) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Ferramentas do Arquiteto: `create_module_map` (modules validado contra ciclos
  na api) e `assign_story_modules`. Retornam `{:ok, map}` ou `{:error, term}`
  (ex.: ciclo / módulo inexistente → 4xx da api).
  """
  @callback create_module_map(
              project_id :: String.t(),
              session_id :: String.t(),
              modules :: [map()]
            ) ::
              {:ok, map()} | {:error, term()}
  @callback assign_story_modules(
              project_id :: String.t(),
              session_id :: String.t(),
              fields :: map()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Ferramenta `create_c4_diagram` do Arquiteto: gera o diagrama C4 (Context +
  Container, modelo de Simon Brown) a partir do module_map vigente. `entrada`
  carrega `system_name`/`system_description`/`actors` — o Container level é
  DERIVADO do module_map na api, nunca redigitado aqui. `{:error, _}` quando
  não há module_map vigente (400) ou a entrada é inválida.
  """
  @callback create_c4_diagram(
              project_id :: String.t(),
              session_id :: String.t(),
              entrada :: map()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Ferramenta `choose_project_image` do Arquiteto (FASE 25a, ADR 0065): fixa a
  imagem de container do projeto. Imagem sem tag explícita, `latest`, rationale
  curto ou recurso acima do teto voltam como `{:error, _}` — a regra é de
  domínio na api, e o motivo chega inteiro ao modelo pelo tool-result.
  """
  @callback decide_project_image(
              project_id :: String.t(),
              session_id :: String.t(),
              decisao :: map()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Ferramenta `route_modules_to_infra` do Arquiteto (ADR 0131): roteia CADA
  módulo do module_map vigente para uma imagem CANDIDATA, com o porquê.
  `roteamento` é a lista `[%{modulo, imagemCandidata, porque}, ...]`. Módulo
  fora do module_map vigente, lista vazia, módulo repetido, ou imagem que
  falha a mesma regra de `choose_project_image` voltam como `{:error, _}`.
  """
  @callback route_modules_to_infra(
              project_id :: String.t(),
              session_id :: String.t(),
              roteamento :: [map()]
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Ciclo de task dos dev agents (Fase 4a). `claim_task` pega a próxima task
  pegável do módulo (atômico na api) — retorna `{:ok, task_map}` ou `{:ok, nil}`
  se não há. `mark_task` atualiza o status.
  """
  @callback claim_task(
              project_id :: String.t(),
              session_id :: String.t(),
              module :: String.t(),
              agent_id :: String.t()
            ) ::
              {:ok, map() | nil} | {:error, term()}
  @callback mark_task(
              project_id :: String.t(),
              session_id :: String.t(),
              task_id :: String.t(),
              status :: String.t(),
              agent_id :: String.t()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Contexto rico da task (Fase 4a) — story completa, regras de negócio e ADRs
  do projeto. Alimenta as camadas `regras_negocio`/`estado_tarefa` do
  DevAgent (`Engine.Dev.ContextBuilder`).
  """
  @callback get_dev_context(
              project_id :: String.t(),
              session_id :: String.t(),
              task_id :: String.t(),
              module :: String.t() | nil
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Devolve a task pra `ready` com diagnóstico (Fase 4a) — o `DevAgentServer`
  chama quando não consegue concluir (bloqueio explícito, limite de
  iterações, ou orçamento de tokens excedido). Nunca deixa a task presa em
  `in_progress` sem desfecho.

  `origin` (Fase 8b, ADR 0020/0038): a ORIGEM da falha
  (`infra`/`modelo`/`codigo`/`politica`), quando conhecida — nunca por
  eliminação. Nasce `nil` de propósito: os ~18 pontos de chamada da Fase 4a
  (`Engine.Dev.AgentIo.block_task/3` e afins) não foram retrofitados nesta
  entrega, só o caminho novo do `QaLeadServer`, que sempre sabe a origem
  porque a recebe do subagente que falhou.
  """
  @callback mark_task_blocked(
              project_id :: String.t(),
              session_id :: String.t(),
              task_id :: String.t(),
              reason :: String.t(),
              diagnosis :: String.t(),
              agent_id :: String.t(),
              origin :: String.t() | nil
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Abre o fluxo de gates de uma PR (Fase 4a) — o `DevAgentServer` chama logo
  depois de `pr_open` executar com sucesso.
  """
  @callback open_gate(
              project_id :: String.t(),
              session_id :: String.t(),
              task_id :: String.t(),
              agent_id :: String.t()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Parecer de um gate de PR (Fase 4a — QA/SecOps): retorna `{:ok, %{"nextAction"
  => "correct"|"run_secops"|"done"|"blocked", "task" => task_map}}` — o
  chamador (QaLeadServer/SecOpsAgentServer) decide o próximo passo a partir
  de `nextAction`. `max_corrections` opcional (nil usa o default da api).
  """
  @callback record_gate_verdict(
              project_id :: String.t(),
              session_id :: String.t(),
              task_id :: String.t(),
              gate :: String.t(),
              veredito :: String.t(),
              resumo :: String.t(),
              itens :: [String.t()],
              max_corrections :: integer() | nil
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Registra o desfecho de UMA delegação da área de QA (Fase 8b, ADR 0038) —
  `completed` (com `parecerArtifactId`), `failed` (com `failureOrigin`) ou
  `dispensed` (com `justification`). O `QaLeadServer` chama isto pra cada
  subespecialidade, SEPARADO da chamada a `record_gate_verdict` — a api nunca
  vê o consolidado como delegação, só o `qa_verdict` final.
  """
  @callback record_delegation(payload :: map()) :: {:ok, map()} | {:error, term()}

  @doc """
  Contexto inicial do InfraAgent (Fase 4a): module_map vigente + ADRs
  `infraRelevant` do projeto. Mirror de `get_dev_context`, sem task/story.
  """
  @callback get_infra_context(project_id :: String.t(), session_id :: String.t()) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Parecer de um gate de PR DE INFRA (Fase 4a — InfraAgent): mesma forma de
  `record_gate_verdict`, mas chaveado por `pr_action_id` (id da
  proposed_action `open_infra_pr`) em vez de `task_id` — o artefato de
  infra não tem task por trás.
  """
  @callback record_infra_gate_verdict(
              project_id :: String.t(),
              session_id :: String.t(),
              pr_action_id :: String.t(),
              gate :: String.t(),
              veredito :: String.t(),
              resumo :: String.t(),
              itens :: [String.t()],
              max_corrections :: integer() | nil
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Lê de volta title+files do payload da proposed_action `open_infra_pr` já
  proposta (Fase 4a) — o `Engine.Infra.InfraGateRunner` usa isso pra rodar
  hadolint/gitleaks/semgrep sobre os arquivos SEM worktree (a PR de infra
  não tem um).
  """
  @callback get_infra_pr_files(
              project_id :: String.t(),
              session_id :: String.t(),
              pr_action_id :: String.t()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Contexto do Psicólogo (Fase 4b): `alreadyAnalyzed` (idempotência),
  `sessionStatus`/`terminationReason` (causa de término), regras de
  negócio do projeto e hipóteses anteriores não descartadas. Os eventos da
  sessão o worker lê direto do Postgres (`Engine.SessionEvents.Event.count/1`
  pra triagem, `list_recent/2` pro prompt), não passam por aqui.
  """
  @callback get_psychologist_context(
              project_id :: String.t(),
              session_id :: String.t()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Registra o lote de hipóteses do Psicólogo (Fase 4b). A api valida que
  TODA evidência aponta pra um event id real da sessão e rejeita o lote
  inteiro (4xx) se qualquer uma falhar — o erro vira o próximo
  tool-result pro modelo corrigir, dentro do teto de max_iterations.
  """
  @callback propose_hypotheses(
              project_id :: String.t(),
              session_id :: String.t(),
              tier :: String.t(),
              triggered_by :: String.t(),
              event_count :: integer(),
              cause :: String.t(),
              hypotheses :: [map()]
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Contexto da rodada da Anamnese (Fase 4b): catálogo de competências
  permitidas, membros elegíveis (já sem quem optou por sair), hipóteses
  aceitas na fila, perfis atuais e a janela a analisar. A janela de
  eventos em si o worker lê direto do Postgres.
  """
  @callback get_anamnese_context(project_id :: String.t()) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Registra os perfis de proficiência da rodada (Fase 4b). A api valida
  contra o catálogo permitido (guarda-corpo: nada de atributo sensível) e
  contra evidência real; rejeição volta como tool-result pro modelo.
  """
  @callback record_proficiency(
              project_id :: String.t(),
              session_id :: String.t(),
              payload :: map()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Dispara o sync de catálogo de modelos na api (Fase 9c).

  Não leva projeto nem sessão: o catálogo é global e a chamada não roda em
  nome de ninguém. Quem AGENDA é o engine (Oban), quem tem as credenciais e o
  registry de providers é a api — duplicar o registry aqui significaria manter
  dois catálogos.

  Retorna o relatório por provider (`%{"porProvider" => [...]}`), que traz o
  motivo do pulo e a ORIGEM da falha de cada um.
  """
  @callback sync_model_catalog() :: {:ok, map()} | {:error, term()}

  @doc """
  Propõe um patch de instrução (Fase 4b). A api calcula o diff e recusa
  repropor um patch já negado antes.
  """
  @callback propose_instruction_patch(
              project_id :: String.t(),
              session_id :: String.t(),
              payload :: map()
            ) ::
              {:ok, map()} | {:error, term()}

  @callback propose_max_parallel(
              project_id :: String.t(),
              session_id :: String.t(),
              payload :: map()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Um turno de LLM pro harness (ToolLoop/ContextManager) — o engine nunca
  fala com provider direto. `messages`/`tools` no formato do contrato
  compartilhado; retorna `{:ok, %{"message" => ..., "usage" => ..., "error"
  => ...}}` (JSON da api) ou `{:error, term}`.
  """
  @callback llm_turn(
              project_id :: String.t(),
              session_id :: String.t(),
              agent :: String.t(),
              messages :: [map()],
              tools :: [map()]
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Busca no RAG do projeto (pgvector, busca híbrida vetor+léxico — ADR
  0080/0082) — `POST /internal/rag/search`. Rota fechada por uma frente
  PARALELA em `apps/api` (N2): o contrato é `{projectId, query, topK}` →
  `{hits: [...], degraded}`, mas o roundtrip real depende dela terminar.

  `top_k` é o teto que a CHAMADORA (a ferramenta `rag_search`, RN-150) já
  clampou — este client não impõe teto próprio, só encaminha. `opts` é
  repassado ao `Req` (ex.: `receive_timeout` num teste), vazio no caminho
  normal.

  Retorna `{:ok, %{"hits" => [%{"path"=>, "chunk"=>, "score"=>, "excerpt"=>},
  ...], "degraded" => bool}}` (corpo cru da api, chaves string) ou
  `{:error, motivo}`.
  """
  @callback rag_search(
              project_id :: String.t(),
              query :: String.t(),
              top_k :: integer(),
              opts :: keyword()
            ) :: {:ok, map()} | {:error, term()}

  @doc """
  Vota num trecho que a busca devolveu — `POST /internal/rag/feedback`
  (RN-480). É o único sinal de VERDADE da medição do RAG: latência e taxa de
  degradação dizem se a busca RODOU, nunca se ela ACERTOU.

  `search_id`/`chunk_id` vêm do resultado da PRÓPRIA `rag_search`; a api
  recusa (400) id que ela não reconheça, e a ferramenta converte essa recusa
  em tool-result de erro para o modelo corrigir (RN-061), nunca em crash.

  Retorna `{:ok, %{"searchId"=>, "chunkId"=>, "verdict"=>, "rank"=>}}` ou
  `{:error, motivo}`.
  """
  @callback rag_feedback(
              project_id :: String.t(),
              search_id :: String.t(),
              chunk_id :: String.t(),
              verdict :: String.t(),
              agent :: String.t()
            ) :: {:ok, map()} | {:error, term()}

  @doc """
  Lê um prompt template versionado do grafo de prompts (ADR pendente da
  frente N2) — `GET /internal/graph/prompt-templates/:name`, com
  `?version=` quando `version` não é `nil` (sem parâmetro busca a versão
  vigente). Rota fechada pela mesma frente PARALELA de `rag_search/4`.

  Retorna `{:ok, %{"name"=>, "version"=>, "body"=>, "hash"=>}}`,
  `{:error, :not_found}` se a api responder 404, ou `{:error, motivo}` para
  qualquer outra falha.
  """
  @callback get_prompt_template(name :: String.t(), version :: String.t() | nil) ::
              {:ok, map()} | {:error, :not_found} | {:error, term()}

  @doc """
  Cria uma proposed_action a partir de uma ferramenta do agente (terminal,
  write_file fora da whitelist) — passa pelo decide/permissions da api.
  Retorna `{:ok, action_map}` (com `"status"`, `"executionResult"` etc.) ou
  `{:error, term}`.
  """
  @callback propose_action(
              project_id :: String.t(),
              session_id :: String.t(),
              action_type :: String.t(),
              actor :: map(),
              payload :: map()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Confirma o caminho de um projeto `execution_mode: runner` (RN-423, ADR
  0104) — o runner é a fonte da verdade: a api SOBRESCREVE `workspacePath`
  com `path` e marca `workspaceVerifiedAt`. `session_id` é `nil` quando o
  projeto ainda não tem sessão nenhuma (`ProjectSession.latest_id/1`) — a
  api atualiza o projeto mesmo assim e só PULA o evento de auditoria nesse
  caso (mesma degradação de `registrar_evento_terminal/3`). `user_id` vem
  do ticket consumido no join (`socket.assigns.user_id`), mesmo padrão de
  `registrar_evento_terminal/3` — é quem aparece como ator do evento.
  Retorna `{:ok, %{"verified" => bool, "workspacePath" => path}}` ou
  `{:error, term}` (400 quando `path` é lexicamente inválido, ou o projeto
  não é `runner`).
  """
  @callback confirm_workspace(
              project_id :: String.t(),
              session_id :: String.t() | nil,
              path :: String.t(),
              user_id :: String.t()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Roda um comando de terminal DENTRO do container real do projeto (ADR
  0134, RN-492) — proxy síncrono até o broker, via
  `POST internal/projects/:projectId/container-exec`. Só chamado por
  `Engine.Actions.TerminalExecutor` quando `decisao_de_execucao/1` resolveu
  `:executar_no_container`; `cwd`, quando presente, já chega TRADUZIDO para
  dentro de `/work` — este cliente não traduz nada.

  `{:ok, %{"sucesso" => true, "exitCode" => _, "output" => _, "timedOut" =>
  _}}` no caminho feliz; `{:ok, %{"sucesso" => false, "motivo" => _}}` é a
  forma NORMAL de "o broker recusou ou não respondeu" (RN-486: container
  registrado `running` não garante que está de pé agora) — não é
  `{:error, _}`. `{:error, reason}` sobra só para falha de TRANSPORTE
  (a api não respondeu, ou respondeu um status que não é 2xx por um motivo
  que não é o broker).
  """
  @callback executar_comando_no_container(
              project_id :: String.t(),
              comando :: String.t(),
              cwd :: String.t() | nil,
              timeout_ms :: pos_integer() | nil
            ) ::
              {:ok, map()} | {:error, term()}

  def llm_turn(project_id, session_id, agent, messages, tools),
    do: impl().llm_turn(project_id, session_id, agent, messages, tools)

  def propose_action(project_id, session_id, action_type, actor, payload),
    do: impl().propose_action(project_id, session_id, action_type, actor, payload)

  def confirm_workspace(project_id, session_id, path, user_id),
    do: impl().confirm_workspace(project_id, session_id, path, user_id)

  def executar_comando_no_container(project_id, comando, cwd, timeout_ms),
    do: impl().executar_comando_no_container(project_id, comando, cwd, timeout_ms)

  def rag_search(project_id, query, top_k, opts \\ []),
    do: impl().rag_search(project_id, query, top_k, opts)

  def rag_feedback(project_id, search_id, chunk_id, verdict, agent),
    do: impl().rag_feedback(project_id, search_id, chunk_id, verdict, agent)

  def get_prompt_template(name, version \\ nil),
    do: impl().get_prompt_template(name, version)

  def report_termination(project_id, session_id, reason, to),
    do: impl().report_termination(project_id, session_id, reason, to)

  def append_event(project_id, session_id, event),
    do: impl().append_event(project_id, session_id, event)

  def append_event_returning(project_id, session_id, event),
    do: impl().append_event_returning(project_id, session_id, event)

  def list_events(project_id, session_id),
    do: impl().list_events(project_id, session_id)

  def llm_turn_stream(project_id, session_id, agent, messages, tools, on_delta),
    do: impl().llm_turn_stream(project_id, session_id, agent, messages, tools, on_delta)

  def session_pending_work(session_id), do: impl().session_pending_work(session_id)

  def get_git_remote(project_id), do: impl().get_git_remote(project_id)

  def create_handoff(project_id, session_id, from_agent, to_agent, artifact_id),
    do: impl().create_handoff(project_id, session_id, from_agent, to_agent, artifact_id)

  def create_epic(project_id, session_id, fields),
    do: impl().create_epic(project_id, session_id, fields)

  def create_story(project_id, session_id, fields),
    do: impl().create_story(project_id, session_id, fields)

  def create_task(project_id, session_id, fields),
    do: impl().create_task(project_id, session_id, fields)

  def list_business_rules(project_id), do: impl().list_business_rules(project_id)

  def list_backlog(project_id), do: impl().list_backlog(project_id)

  def list_product_metrics(project_id), do: impl().list_product_metrics(project_id)

  def create_module_map(project_id, session_id, modules),
    do: impl().create_module_map(project_id, session_id, modules)

  def create_c4_diagram(project_id, session_id, entrada),
    do: impl().create_c4_diagram(project_id, session_id, entrada)

  def assign_story_modules(project_id, session_id, fields),
    do: impl().assign_story_modules(project_id, session_id, fields)

  def decide_project_image(project_id, session_id, decisao),
    do: impl().decide_project_image(project_id, session_id, decisao)

  def route_modules_to_infra(project_id, session_id, roteamento),
    do: impl().route_modules_to_infra(project_id, session_id, roteamento)

  def claim_task(project_id, session_id, module, agent_id),
    do: impl().claim_task(project_id, session_id, module, agent_id)

  def mark_task(project_id, session_id, task_id, status, agent_id),
    do: impl().mark_task(project_id, session_id, task_id, status, agent_id)

  def get_dev_context(project_id, session_id, task_id, module \\ nil),
    do: impl().get_dev_context(project_id, session_id, task_id, module)

  def mark_task_blocked(
        project_id,
        session_id,
        task_id,
        reason,
        diagnosis,
        agent_id,
        origin \\ nil
      ),
      do:
        impl().mark_task_blocked(
          project_id,
          session_id,
          task_id,
          reason,
          diagnosis,
          agent_id,
          origin
        )

  def open_gate(project_id, session_id, task_id, agent_id),
    do: impl().open_gate(project_id, session_id, task_id, agent_id)

  def record_gate_verdict(
        project_id,
        session_id,
        task_id,
        gate,
        veredito,
        resumo,
        itens,
        max_corrections \\ nil
      ),
      do:
        impl().record_gate_verdict(
          project_id,
          session_id,
          task_id,
          gate,
          veredito,
          resumo,
          itens,
          max_corrections
        )

  def record_delegation(payload), do: impl().record_delegation(payload)

  def get_infra_context(project_id, session_id),
    do: impl().get_infra_context(project_id, session_id)

  def get_infra_pr_files(project_id, session_id, pr_action_id),
    do: impl().get_infra_pr_files(project_id, session_id, pr_action_id)

  def get_psychologist_context(project_id, session_id),
    do: impl().get_psychologist_context(project_id, session_id)

  def get_anamnese_context(project_id),
    do: impl().get_anamnese_context(project_id)

  def record_proficiency(project_id, session_id, payload),
    do: impl().record_proficiency(project_id, session_id, payload)

  def propose_instruction_patch(project_id, session_id, payload),
    do: impl().propose_instruction_patch(project_id, session_id, payload)

  def propose_max_parallel(project_id, session_id, payload),
    do: impl().propose_max_parallel(project_id, session_id, payload)

  def propose_hypotheses(
        project_id,
        session_id,
        tier,
        triggered_by,
        event_count,
        cause,
        hypotheses
      ),
      do:
        impl().propose_hypotheses(
          project_id,
          session_id,
          tier,
          triggered_by,
          event_count,
          cause,
          hypotheses
        )

  def record_infra_gate_verdict(
        project_id,
        session_id,
        pr_action_id,
        gate,
        veredito,
        resumo,
        itens,
        max_corrections \\ nil
      ),
      do:
        impl().record_infra_gate_verdict(
          project_id,
          session_id,
          pr_action_id,
          gate,
          veredito,
          resumo,
          itens,
          max_corrections
        )

  defp impl,
    do: Application.get_env(:engine, :engine_api_client, Engine.Sessions.EngineApiClient.Live)
end

defmodule Engine.Sessions.EngineApiClient.Live do
  @moduledoc """
  Cliente HTTP real: chama os endpoints internos da api
  (POST .../termination, POST .../events) autenticado pelo segredo
  compartilhado `BRABO_SERVICE_TOKEN`.

  Até a Fase 7a isto buscava um token client-credentials no Keycloak e o
  cacheava em `:persistent_term` até expirar. Removido o Keycloak, o valor é
  uma variável de ambiente — ler env por chamada custa menos do que a
  invalidação que o cache exigia, e some um caminho de rede que podia falhar
  no meio de qualquer operação.
  """

  @behaviour Engine.Sessions.EngineApiClient
  @cabecalho_service_token "x-brabo-service-token"

  @impl true
  def report_termination(project_id, session_id, reason, to) do
    post("/internal/sessions/#{session_id}/termination", %{
      projectId: project_id,
      reason: reason,
      to: to
    })
  end

  @impl true
  def append_event(project_id, session_id, event) do
    post(
      "/internal/sessions/#{session_id}/events",
      Map.put(event, :projectId, project_id)
    )
  end

  @impl true
  def append_event_returning(project_id, session_id, event) do
    post_returning(
      "/internal/sessions/#{session_id}/events",
      Map.put(event, :projectId, project_id)
    )
  end

  @impl true
  def list_events(project_id, session_id) do
    url =
      api_url() <>
        "/internal/sessions/#{session_id}/events?projectId=#{project_id}&limit=200"

    case Req.get(url, headers: headers()) do
      {:ok, %Req.Response{status: status, body: %{"items" => items}}}
      when status in 200..299 ->
        {:ok, items}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def sync_model_catalog do
    post_returning("/internal/models/sync", %{})
  end

  @impl true
  def create_handoff(project_id, session_id, from_agent, to_agent, artifact_id) do
    post_returning("/internal/sessions/#{session_id}/handoffs", %{
      projectId: project_id,
      fromAgent: from_agent,
      toAgent: to_agent,
      artifactId: artifact_id
    })
  end

  @impl true
  def create_epic(project_id, session_id, fields) do
    post_returning(
      "/internal/sessions/#{session_id}/epics",
      Map.put(fields, :projectId, project_id)
    )
  end

  @impl true
  def create_story(project_id, session_id, fields) do
    post_returning(
      "/internal/sessions/#{session_id}/stories",
      Map.put(fields, :projectId, project_id)
    )
  end

  @impl true
  def create_task(project_id, session_id, fields) do
    post_returning(
      "/internal/sessions/#{session_id}/tasks",
      Map.put(fields, :projectId, project_id)
    )
  end

  @impl true
  def create_module_map(project_id, session_id, modules) do
    post_returning("/internal/sessions/#{session_id}/module-map", %{
      projectId: project_id,
      modules: modules
    })
  end

  @impl true
  def create_c4_diagram(project_id, session_id, entrada) do
    post_returning(
      "/internal/sessions/#{session_id}/c4-diagram",
      Map.put(entrada, :projectId, project_id)
    )
  end

  @impl true
  def assign_story_modules(project_id, session_id, fields) do
    post_returning(
      "/internal/sessions/#{session_id}/story-modules",
      Map.put(fields, :projectId, project_id)
    )
  end

  @impl true
  def decide_project_image(project_id, session_id, decisao) do
    post_returning(
      "/internal/sessions/#{session_id}/project-image",
      Map.put(decisao, :projectId, project_id)
    )
  end

  @impl true
  def route_modules_to_infra(project_id, session_id, roteamento) do
    post_returning("/internal/sessions/#{session_id}/module-routing", %{
      projectId: project_id,
      roteamento: roteamento
    })
  end

  @impl true
  def claim_task(project_id, session_id, module, agent_id) do
    # Sem task pegável NÃO é erro — e não chega como `null`.
    #
    # O caso de uso devolve `null`, mas o NestJS serializa isso como resposta
    # VAZIA: `201` com `content-length: 0`. O `Req` entrega `body: ""`, que não
    # é `nil` — então `AgentIo.try_claim/2` casava com a cláusula de task
    # encontrada e chamava `run_task("")`, estourando `BadMapError` em
    # `Map.get("", "id", nil)`. Como o server é `restart: :temporary`, o agente
    # morria de vez e o `Monitor` apagava a linha de estado logo atrás.
    #
    # O efeito é o oposto do que a Fase 12b entregou: em vez de `dev.idle`
    # supervisionado e acordável por evento, processo morto — e no momento MAIS
    # comum que existe, o da fila do módulo esvaziando. Vale para o dev agent
    # REAL, não só para o Noop: `try_claim/2` mora no `AgentIo` compartilhado.
    #
    # Normalizado aqui, no consumidor, e não mudando o status HTTP da rota:
    # corpo vazio é "nada pegável" venha de onde vier, e o contrato que outros
    # consumidores observam fica intocado.
    case post_returning("/internal/sessions/#{session_id}/tasks/claim", %{
           projectId: project_id,
           module: module,
           agentId: agent_id
         }) do
      {:ok, corpo} when corpo in ["", nil] -> {:ok, nil}
      outro -> outro
    end
  end

  @impl true
  def mark_task(project_id, session_id, task_id, status, agent_id) do
    post_returning("/internal/sessions/#{session_id}/tasks/#{task_id}/status", %{
      projectId: project_id,
      agentId: agent_id,
      status: status
    })
  end

  @impl true
  def mark_task_blocked(project_id, session_id, task_id, reason, diagnosis, agent_id, origin) do
    post_returning("/internal/sessions/#{session_id}/tasks/#{task_id}/block", %{
      projectId: project_id,
      agentId: agent_id,
      reason: reason,
      diagnosis: diagnosis,
      origin: origin
    })
  end

  @impl true
  def open_gate(project_id, session_id, task_id, agent_id) do
    post_returning("/internal/sessions/#{session_id}/tasks/#{task_id}/gate/open", %{
      projectId: project_id,
      agentId: agent_id
    })
  end

  @impl true
  def record_gate_verdict(
        project_id,
        session_id,
        task_id,
        gate,
        veredito,
        resumo,
        itens,
        max_corrections
      ) do
    post_returning("/internal/sessions/#{session_id}/gates/verdict", %{
      projectId: project_id,
      taskId: task_id,
      gate: gate,
      veredito: veredito,
      resumo: resumo,
      itens: itens,
      maxCorrections: max_corrections
    })
  end

  @impl true
  def record_delegation(%{session_id: session_id} = payload) do
    post_returning("/internal/sessions/#{session_id}/delegations", %{
      projectId: payload.project_id,
      taskId: Map.get(payload, :task_id),
      area: payload.area,
      leadAgent: payload.lead_agent,
      subagent: payload.subagent,
      status: payload.status,
      parecerArtifactId: Map.get(payload, :parecer_artifact_id),
      failureOrigin: Map.get(payload, :failure_origin),
      failureReason: Map.get(payload, :failure_reason),
      justification: Map.get(payload, :justification)
    })
  end

  @impl true
  def get_dev_context(project_id, session_id, task_id, module \\ nil) do
    # `module` filtra os ADRs pro módulo do dev (ADR sem módulo é transversal
    # e entra sempre). Nulo = sem filtro — é o caso dos gates QA/SecOps, que
    # reusam este contexto e querem o acervo inteiro.
    module_query = if module, do: "&module=#{URI.encode_www_form(module)}", else: ""

    url =
      api_url() <>
        "/internal/sessions/#{session_id}/dev-context?projectId=#{project_id}&taskId=#{task_id}" <>
        module_query

    case Req.get(url, headers: headers()) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def session_pending_work(session_id) do
    url = api_url() <> "/internal/sessions/#{session_id}/pending-work"

    case Req.get(url, headers: headers()) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok, %{pending: Map.get(body, "pending", false), motivo: Map.get(body, "motivo")}}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def get_git_remote(project_id) do
    url = api_url() <> "/internal/projects/#{project_id}/git-remote"

    case Req.get(url, headers: headers()) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok,
         %{
           kind: Map.get(body, "kind"),
           origin: Map.get(body, "origin"),
           default_branch: Map.get(body, "defaultBranch"),
           token: Map.get(body, "token"),
           username: Map.get(body, "username")
         }}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def list_business_rules(project_id) do
    get_json("/internal/projects/#{project_id}/business-rules")
  end

  @impl true
  def list_backlog(project_id) do
    get_json("/internal/projects/#{project_id}/backlog")
  end

  @impl true
  def list_product_metrics(project_id) do
    get_json("/internal/projects/#{project_id}/product-metrics")
  end

  # GET que devolve o corpo decodificado. Existe para as leituras do PO
  # (RN-164) e NÃO foi retrofitado nos seis GETs anteriores de propósito:
  # cada um deles normaliza o corpo do seu jeito (o `get_git_remote` recasa
  # chave por chave, o `session_pending_work` extrai dois campos), e trocar
  # isso por um helper comum seria refatorar caminho que já está provado.
  defp get_json(path) do
    case Req.get(api_url() <> path, headers: headers()) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def get_infra_context(project_id, session_id) do
    url =
      api_url() <>
        "/internal/sessions/#{session_id}/infra-context?projectId=#{project_id}"

    case Req.get(url, headers: headers()) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def get_infra_pr_files(project_id, session_id, pr_action_id) do
    url =
      api_url() <>
        "/internal/sessions/#{session_id}/infra-artifacts/#{pr_action_id}/files?projectId=#{project_id}"

    case Req.get(url, headers: headers()) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def get_psychologist_context(project_id, session_id) do
    url =
      api_url() <>
        "/internal/sessions/#{session_id}/psychologist-context?projectId=#{project_id}"

    case Req.get(url, headers: headers()) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def get_anamnese_context(project_id) do
    # O endpoint mora sob /sessions só pela convenção do
    # EngineServiceGuard; o contexto é do PROJETO, então o segmento de
    # sessão é irrelevante aqui.
    url = api_url() <> "/internal/sessions/_/anamnese-context?projectId=#{project_id}"

    case Req.get(url, headers: headers()) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def record_proficiency(project_id, session_id, payload) do
    post_returning(
      "/internal/sessions/#{session_id}/proficiency",
      Map.put(payload, :projectId, project_id)
    )
  end

  @impl true
  def propose_instruction_patch(project_id, session_id, payload) do
    post_returning(
      "/internal/sessions/#{session_id}/instruction-patches",
      Map.put(payload, :projectId, project_id)
    )
  end

  @impl true
  def propose_max_parallel(project_id, session_id, payload) do
    post_returning(
      "/internal/sessions/#{session_id}/max-parallel-proposals",
      Map.put(payload, :projectId, project_id)
    )
  end

  @impl true
  def propose_hypotheses(
        project_id,
        session_id,
        tier,
        triggered_by,
        event_count,
        cause,
        hypotheses
      ) do
    post_returning("/internal/sessions/#{session_id}/hypotheses", %{
      projectId: project_id,
      tier: tier,
      triggeredBy: triggered_by,
      eventCount: event_count,
      cause: cause,
      hypotheses: hypotheses
    })
  end

  @impl true
  def record_infra_gate_verdict(
        project_id,
        session_id,
        pr_action_id,
        gate,
        veredito,
        resumo,
        itens,
        max_corrections
      ) do
    post_returning("/internal/sessions/#{session_id}/infra-gates/verdict", %{
      projectId: project_id,
      prActionId: pr_action_id,
      gate: gate,
      veredito: veredito,
      resumo: resumo,
      itens: itens,
      maxCorrections: max_corrections
    })
  end

  @impl true
  def llm_turn_stream(project_id, session_id, agent, messages, tools, on_delta) do
    body = %{projectId: project_id, agentId: agent, messages: messages, tools: tools}
    key = {__MODULE__, :sse, make_ref()}
    Process.put(key, %{buffer: "", final: nil})

    into = fn {:data, data}, {req, resp} ->
      Process.put(key, consume_sse(Process.get(key), data, on_delta))
      {:cont, {req, resp}}
    end

    # O MESMO teto do `llm_turn/5`. Sem ele valia o default do Req (15s), e o
    # turno dos quatro agentes conversacionais — que só passam por aqui —
    # morria com `%Req.TransportError{reason: :timeout}` antes do modelo
    # responder. Com Ollama local o turno cabia nos 15s e o defeito não
    # aparecia; com provider de API e contexto grande, não cabe.
    #
    # Em resposta streamada o `receive_timeout` do Req vale por CHUNK, então
    # aqui ele é o teto de inatividade que o ADR 0041 pede — não o da resposta
    # inteira.
    result =
      Req.post(api_url() <> "/internal/sessions/#{session_id}/llm-turn-stream",
        json: body,
        headers: headers(),
        into: into,
        receive_timeout: llm_turn_timeout_ms()
      )

    state = Process.get(key)
    Process.delete(key)

    case result do
      {:ok, %Req.Response{status: status}} when status in 200..299 ->
        if state.final, do: {:ok, state.final}, else: {:error, :no_final_event}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # Parseia frames SSE (`data: <json>\n\n`) de um chunk, chamando `on_delta`
  # por delta de texto e guardando o evento `final`. Mantém no `buffer` o
  # resto de um frame ainda incompleto entre chunks.
  defp consume_sse(state, data, on_delta) do
    buffer = state.buffer <> data
    parts = String.split(buffer, "\n\n")
    {frames, [rest]} = Enum.split(parts, -1)

    final =
      Enum.reduce(frames, state.final, fn frame, acc ->
        case parse_sse_frame(frame) do
          {:ok, %{"type" => "delta", "text" => text}} ->
            on_delta.(text)
            acc

          {:ok, %{"type" => "final"} = f} ->
            f

          _ ->
            acc
        end
      end)

    %{buffer: rest, final: final}
  end

  defp parse_sse_frame(frame) do
    frame
    |> String.split("\n")
    |> Enum.filter(&String.starts_with?(&1, "data:"))
    |> Enum.map_join("", fn line ->
      line |> String.replace_prefix("data:", "") |> String.trim()
    end)
    |> case do
      "" -> :error
      json -> Jason.decode(json)
    end
  end

  @impl true
  def llm_turn(project_id, session_id, agent, messages, tools) do
    # Timeout generoso e configurável: um turno de LLM não é uma chamada de
    # API comum. Com modelo local (Ollama), o PRIMEIRO turno ainda carrega
    # vários GB de pesos na memória antes de gerar o primeiro token — no
    # default do Req isso estoura, o ToolLoop recebe {:error, :timeout} e a
    # task é bloqueada com "parou sem concluir", sem o operador entender por
    # quê. Ver DEFAULT_LLM_TURN_TIMEOUT_MS / LLM_TURN_TIMEOUT_MS.
    Engine.Telemetry.Span.with_span(
      "llm.turn",
      %{
        "brabo.agent" => agent,
        "brabo.session_id" => session_id,
        "brabo.llm.messages" => length(messages),
        "brabo.llm.tools" => length(tools)
      },
      fn ->
        result =
          post_returning(
            "/internal/sessions/#{session_id}/llm-turn",
            %{
              projectId: project_id,
              agentId: agent,
              messages: messages,
              tools: tools
            },
            receive_timeout: llm_turn_timeout_ms()
          )

        # A api responde 200 com `error` no CORPO quando o provider falha (não
        # um status de erro). Sem registrar isso como atributo, um turno que
        # falhou apareceria no Tempo indistinguível de um que deu certo.
        annotate_llm_turn(result)
        result
      end
    )
  end

  defp annotate_llm_turn({:ok, %{"usage" => %{"costMicros" => cost}} = resp}) do
    Engine.Telemetry.Span.set_attributes(%{
      "brabo.llm.cost_micros" => cost,
      "brabo.llm.error" => Map.get(resp, "error") || false
    })
  end

  defp annotate_llm_turn({:ok, resp}) when is_map(resp) do
    Engine.Telemetry.Span.set_attributes(%{
      "brabo.llm.error" => Map.get(resp, "error") || false
    })
  end

  defp annotate_llm_turn(_), do: :ok

  defp llm_turn_timeout_ms,
    do: Application.get_env(:engine, :llm_turn_timeout_ms, 300_000)

  @impl true
  def propose_action(project_id, session_id, action_type, actor, payload) do
    post_returning("/internal/sessions/#{session_id}/actions", %{
      projectId: project_id,
      actionType: action_type,
      actor: actor,
      payload: payload
    })
  end

  @impl true
  def confirm_workspace(project_id, session_id, path, user_id) do
    post_returning("/internal/projects/#{project_id}/workspace-verification", %{
      sessionId: session_id,
      path: path,
      actorId: user_id
    })
  end

  @impl true
  def executar_comando_no_container(project_id, comando, cwd, timeout_ms) do
    corpo =
      %{comando: comando}
      |> por_se_presente(:cwd, cwd)
      |> por_se_presente(:timeoutMs, timeout_ms)

    post_returning("/internal/projects/#{project_id}/container-exec", corpo)
  end

  @impl true
  def rag_search(project_id, query, top_k, opts \\ []) do
    # `:session_id`/`:agent` são de DOMÍNIO — entram no CORPO, e é o que
    # permite a api gravar o ator da telemetria e narrar `rag.search` na
    # timeline (RN-479/481). O resto de `opts` continua indo para o `Req`,
    # como sempre foi. Separá-los aqui evita um quinto parâmetro posicional
    # que todo chamador teria de passar mesmo sem ter o que dizer.
    {session_id, opts} = Keyword.pop(opts, :session_id)
    {agent, opts} = Keyword.pop(opts, :agent)

    corpo =
      %{projectId: project_id, query: query, topK: top_k}
      |> por_se_presente(:sessionId, session_id)
      |> por_se_presente(:agent, agent)

    post_returning("/internal/rag/search", corpo, opts)
  end

  @impl true
  def rag_feedback(project_id, search_id, chunk_id, verdict, agent) do
    post_returning("/internal/rag/feedback", %{
      projectId: project_id,
      searchId: search_id,
      chunkId: chunk_id,
      verdict: verdict,
      agent: agent
    })
  end

  # A api distingue campo AUSENTE de campo NULO: mandar `sessionId: null` faria
  # o DTO recusar o corpo pela validação de UUID. Ausente é o contrato.
  defp por_se_presente(mapa, _chave, nil), do: mapa
  defp por_se_presente(mapa, chave, valor), do: Map.put(mapa, chave, valor)

  @impl true
  def get_prompt_template(name, version \\ nil) do
    query_part = if version, do: "?version=#{URI.encode_www_form(version)}", else: ""

    url =
      api_url() <>
        "/internal/graph/prompt-templates/#{URI.encode_www_form(name)}" <> query_part

    case Req.get(url, headers: headers()) do
      {:ok, %Req.Response{status: 404}} ->
        {:error, :not_found}

      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # O funil ÚNICO de headers de toda chamada engine -> api (ADR 0035).
  #
  # `auth_headers/0` sozinho era o bug: ele já era um funil, mas só do token.
  # O `traceparent` era injetado uma camada acima, dentro de `post_returning/3`,
  # e por isso cobria apenas os POSTs. Ficavam de fora os seis `Req.get` (que
  # incluem `list_events` e as leituras que montam o contexto do agente) e o
  # `llm_turn_stream`, o turno de LLM em streaming — indiscutivelmente a chamada
  # mais interessante do sistema. Toda a metade de LEITURA da conversa entre os
  # dois serviços aparecia no Tempo como trace órfã.
  #
  # Agora é um só: quem chama a api usa `headers/0`, e `auth_headers/0` existe
  # apenas para ser composta aqui.
  # Pública (e `@doc false`) só para ser testável: `engine_api_client_headers_test.exs`
  # afirma que o token sobrevive e que o traceparent aparece dentro de span. Não
  # faz parte do contrato do módulo — o behaviour lá em cima é que faz.
  @doc false
  def headers, do: trace_headers(auth_headers())

  # Acrescenta o `traceparent` do contexto ativo (Fase 5, item 3). O parâmetro se
  # chama `base` e não `headers` para não sombrear a `headers/0` acima.
  defp trace_headers(base) do
    case Engine.Telemetry.Span.current_traceparent() do
      nil -> base
      tp -> [{"traceparent", tp} | base]
    end
  end

  defp post(path, body) do
    case post_returning(path, body) do
      {:ok, _body} -> :ok
      error -> error
    end
  end

  # Igual `post/2` mas devolve o corpo da resposta (llm_turn/propose_action
  # precisam do JSON de volta, não só do :ok).
  defp post_returning(path, body, opts \\ []) do
    case Req.post(
           [
             url: api_url() <> path,
             json: body,
             headers: headers()
           ] ++ opts
         ) do
      {:ok, %Req.Response{status: status, body: resp}} when status in 200..299 ->
        {:ok, resp}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # Um lugar só monta o cabeçalho de auth. Antes eram oito literais iguais
  # espalhados pelos GETs, pelo stream e pelo funil de POST — e um deles
  # esquecido numa troca de mecanismo é uma rota que passa a falhar sozinha.
  defp auth_headers, do: [{@cabecalho_service_token, service_token()}]

  defp service_token, do: Application.fetch_env!(:engine, :service_token)

  defp api_url, do: Application.fetch_env!(:engine, :api_url)
end
