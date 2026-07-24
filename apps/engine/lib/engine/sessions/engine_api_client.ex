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
