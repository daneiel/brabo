defmodule Engine.Auth.ApiTokenVerifier do
  @moduledoc """
  Valida um token client-credentials do Keycloak vindo da api (assinatura
  via JWKS remoto, expiração, issuer). Não checa QUAL client — isso é
  responsabilidade de EngineWeb.Plugs.VerifyApiToken, que olha o claim
  `azp` depois da verificação de assinatura passar aqui.
  """

  use Joken.Config

  add_hook(JokenJwks, strategy: Engine.Auth.JwksStrategy)

  @impl true
  def token_config do
    default_claims(skip: [:aud, :iss])
    |> add_claim("iss", nil, &(&1 == expected_issuer()))
  end

  defp expected_issuer do
    keycloak_url = Application.fetch_env!(:engine, :keycloak_url)
    realm = Application.fetch_env!(:engine, :keycloak_realm)
    "#{keycloak_url}/realms/#{realm}"
  end
end
