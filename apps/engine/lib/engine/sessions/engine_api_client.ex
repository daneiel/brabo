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
