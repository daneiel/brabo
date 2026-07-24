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
              task_id :: String.t()
            ) ::
              {:ok, map()} | {:error, term()}

  @doc """
  Devolve a task pra `ready` com diagnóstico (Fase 4a) — o `DevAgentServer`
  chama quando não consegue concluir (bloqueio explícito, limite de
  iterações, ou orçamento de tokens excedido). Nunca deixa a task presa em
  `in_progress` sem desfecho.
  """
  @callback mark_task_blocked(
              project_id :: String.t(),
              session_id :: String.t(),
              task_id :: String.t(),
              reason :: String.t(),
              diagnosis :: String.t(),
              agent_id :: String.t()
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
  chamador (QaAgentServer/SecOpsAgentServer) decide o próximo passo a partir
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
  negócio do projeto e hipóteses anteriores não descartadas. O log
  completo de eventos da sessão o worker lê direto do Postgres
  (`Engine.SessionEvents.Event.list/1`), não passa por aqui.
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
  Propõe um patch de instrução (Fase 4b). A api calcula o diff e recusa
  repropor um patch já negado antes.
  """
  @callback propose_instruction_patch(
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

  def llm_turn(project_id, session_id, agent, messages, tools),
    do: impl().llm_turn(project_id, session_id, agent, messages, tools)

  def propose_action(project_id, session_id, action_type, actor, payload),
    do: impl().propose_action(project_id, session_id, action_type, actor, payload)

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

  def create_handoff(project_id, session_id, from_agent, to_agent, artifact_id),
    do: impl().create_handoff(project_id, session_id, from_agent, to_agent, artifact_id)

  def create_epic(project_id, session_id, fields),
    do: impl().create_epic(project_id, session_id, fields)

  def create_story(project_id, session_id, fields),
    do: impl().create_story(project_id, session_id, fields)

  def create_task(project_id, session_id, fields),
    do: impl().create_task(project_id, session_id, fields)

  def create_module_map(project_id, session_id, modules),
    do: impl().create_module_map(project_id, session_id, modules)

  def assign_story_modules(project_id, session_id, fields),
    do: impl().assign_story_modules(project_id, session_id, fields)

  def claim_task(project_id, session_id, module, agent_id),
    do: impl().claim_task(project_id, session_id, module, agent_id)

  def mark_task(project_id, session_id, task_id, status, agent_id),
    do: impl().mark_task(project_id, session_id, task_id, status, agent_id)

  def get_dev_context(project_id, session_id, task_id),
    do: impl().get_dev_context(project_id, session_id, task_id)

  def mark_task_blocked(project_id, session_id, task_id, reason, diagnosis, agent_id),
    do: impl().mark_task_blocked(project_id, session_id, task_id, reason, diagnosis, agent_id)

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

  def propose_hypotheses(project_id, session_id, tier, triggered_by, event_count, hypotheses),
    do:
      impl().propose_hypotheses(
        project_id,
        session_id,
        tier,
        triggered_by,
        event_count,
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
  Cliente HTTP real: busca um token client-credentials no Keycloak
  (cacheado em :persistent_term — escrita rara o suficiente pra não
  justificar outro processo supervisionado) e chama os endpoints
  internos da api (POST .../termination, POST .../events).
  """

  @behaviour Engine.Sessions.EngineApiClient
  @cache_key {__MODULE__, :token}

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

    case Req.get(url, headers: [{"authorization", "Bearer #{token()}"}]) do
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
  def assign_story_modules(project_id, session_id, fields) do
    post_returning(
      "/internal/sessions/#{session_id}/story-modules",
      Map.put(fields, :projectId, project_id)
    )
  end

  @impl true
  def claim_task(project_id, session_id, module, agent_id) do
    # `null` (sem task pegável) volta como {:ok, nil} — não é erro.
    post_returning("/internal/sessions/#{session_id}/tasks/claim", %{
      projectId: project_id,
      module: module,
      agentId: agent_id
    })
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
  def mark_task_blocked(project_id, session_id, task_id, reason, diagnosis, agent_id) do
    post_returning("/internal/sessions/#{session_id}/tasks/#{task_id}/block", %{
      projectId: project_id,
      agentId: agent_id,
      reason: reason,
      diagnosis: diagnosis
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
  def get_dev_context(project_id, session_id, task_id) do
    url =
      api_url() <>
        "/internal/sessions/#{session_id}/dev-context?projectId=#{project_id}&taskId=#{task_id}"

    case Req.get(url, headers: [{"authorization", "Bearer #{token()}"}]) do
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

    case Req.get(url, headers: [{"authorization", "Bearer #{token()}"}]) do
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

    case Req.get(url, headers: [{"authorization", "Bearer #{token()}"}]) do
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

    case Req.get(url, headers: [{"authorization", "Bearer #{token()}"}]) do
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

    case Req.get(url, headers: [{"authorization", "Bearer #{token()}"}]) do
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
  def propose_hypotheses(project_id, session_id, tier, triggered_by, event_count, hypotheses) do
    post_returning("/internal/sessions/#{session_id}/hypotheses", %{
      projectId: project_id,
      tier: tier,
      triggeredBy: triggered_by,
      eventCount: event_count,
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

    result =
      Req.post(api_url() <> "/internal/sessions/#{session_id}/llm-turn-stream",
        json: body,
        headers: [{"authorization", "Bearer #{token()}"}],
        into: into
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
    post_returning("/internal/sessions/#{session_id}/llm-turn", %{
      projectId: project_id,
      agentId: agent,
      messages: messages,
      tools: tools
    })
  end

  @impl true
  def propose_action(project_id, session_id, action_type, actor, payload) do
    post_returning("/internal/sessions/#{session_id}/actions", %{
      projectId: project_id,
      actionType: action_type,
      actor: actor,
      payload: payload
    })
  end

  defp post(path, body) do
    case post_returning(path, body) do
      {:ok, _body} -> :ok
      error -> error
    end
  end

  # Igual `post/2` mas devolve o corpo da resposta (llm_turn/propose_action
  # precisam do JSON de volta, não só do :ok).
  defp post_returning(path, body) do
    case Req.post(api_url() <> path,
           json: body,
           headers: [{"authorization", "Bearer #{token()}"}]
         ) do
      {:ok, %Req.Response{status: status, body: resp}} when status in 200..299 ->
        {:ok, resp}

      {:ok, %Req.Response{status: status, body: resp}} ->
        {:error, {status, resp}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp token do
    case :persistent_term.get(@cache_key, nil) do
      {token, exp} -> if System.system_time(:second) < exp, do: token, else: fetch_and_cache()
      nil -> fetch_and_cache()
    end
  end

  defp fetch_and_cache do
    %Req.Response{status: 200, body: %{"access_token" => token, "expires_in" => ttl}} =
      Req.post!(
        "#{keycloak_url()}/realms/#{realm()}/protocol/openid-connect/token",
        form: [
          grant_type: "client_credentials",
          client_id: client_id(),
          client_secret: client_secret()
        ]
      )

    :persistent_term.put(@cache_key, {token, System.system_time(:second) + ttl - 5})
    token
  end

  defp api_url, do: Application.fetch_env!(:engine, :api_url)
  defp keycloak_url, do: Application.fetch_env!(:engine, :keycloak_url)
  defp realm, do: Application.fetch_env!(:engine, :keycloak_realm)
  defp client_id, do: Application.fetch_env!(:engine, :engine_keycloak_client_id)
  defp client_secret, do: Application.fetch_env!(:engine, :engine_keycloak_client_secret)
end
