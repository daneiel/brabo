defmodule Engine.Sessions.EngineApiClient do
  @moduledoc """
  Contrato pro callback engine -> api. Trocável em teste via
  `Application.get_env(:engine, :engine_api_client, ...)`, sem Mox.
  """

  @callback report_termination(
              project_id :: String.t(),
              session_id :: String.t(),
              reason :: String.t()
            ) ::
              :ok | {:error, term()}
end

defmodule Engine.Sessions.EngineApiClient.Live do
  @moduledoc """
  Cliente HTTP real: busca um token client-credentials no Keycloak
  (cacheado em :persistent_term — escrita rara o suficiente pra não
  justificar outro processo supervisionado) e chama
  POST /internal/sessions/:id/termination na api.
  """

  @behaviour Engine.Sessions.EngineApiClient
  @cache_key {__MODULE__, :token}

  @impl true
  def report_termination(project_id, session_id, reason) do
    url = api_url() <> "/internal/sessions/#{session_id}/termination"

    case Req.post(url,
           json: %{projectId: project_id, reason: reason},
           headers: [{"authorization", "Bearer #{token()}"}]
         ) do
      {:ok, %Req.Response{status: status}} when status in 200..299 -> :ok
      {:ok, %Req.Response{status: status, body: body}} -> {:error, {status, body}}
      {:error, reason} -> {:error, reason}
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
