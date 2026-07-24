defmodule EngineWeb.Plugs.VerifyApiToken do
  @moduledoc """
  Mirror conceitual do EngineServiceGuard do lado da api: valida o Bearer
  token (assinatura/exp/iss via Engine.Auth.ApiTokenVerifier) e depois
  restringe ao client esperado (claim `azp`), configurável via
  API_KEYCLOAK_CLIENT_ID.
  """

  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    with {:ok, token} <- extract_bearer(conn),
         {:ok, claims} <- Engine.Auth.ApiTokenVerifier.verify_and_validate(token),
         :ok <- check_client(claims) do
      conn
    else
      _ ->
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(401, Jason.encode!(%{error: "token inválido ou não autorizado"}))
        |> halt()
    end
  end

  defp extract_bearer(conn) do
    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] -> {:ok, token}
      _ -> {:error, :missing_token}
    end
  end

  defp check_client(%{"azp" => azp}) do
    if azp == expected_client_id(), do: :ok, else: {:error, :unexpected_client}
  end

  defp check_client(_), do: {:error, :missing_azp}

  defp expected_client_id do
    Application.fetch_env!(:engine, :api_keycloak_client_id)
  end
end
