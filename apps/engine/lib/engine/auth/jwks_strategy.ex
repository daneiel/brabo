defmodule Engine.Auth.JwksStrategy do
  @moduledoc """
  Estratégia de fetch/cache/refresh do JWKS do Keycloak, pro
  ApiTokenVerifier validar assinatura de tokens vindos da api (comando
  síncrono POST /internal/sessions). Papel equivalente ao
  createRemoteJWKSet do `jose`/Node já usado do lado da api.
  """

  use JokenJwks.DefaultStrategyTemplate

  def init_opts(opts) do
    keycloak_url = Application.fetch_env!(:engine, :keycloak_url)
    realm = Application.fetch_env!(:engine, :keycloak_realm)
    jwks_url = "#{keycloak_url}/realms/#{realm}/protocol/openid-connect/certs"

    # first_fetch_sync: true — só um serviço interno de baixo tráfego;
    # vale um boot alguns ms mais lento pra nunca ter uma janela logo
    # após subir onde toda chamada falha com :no_signers_fetched.
    #
    # http_adapter: Tesla.Adapter.Httpc — o default do joken_jwks é
    # Tesla.Adapter.Hackney, que exigiria adicionar `hackney` como
    # dependência nova. `:httpc` já vem com o Erlang/OTP, zero dependência
    # adicional.
    Keyword.merge(opts,
      jwks_url: jwks_url,
      first_fetch_sync: true,
      http_adapter: Tesla.Adapter.Httpc
    )
  end
end
