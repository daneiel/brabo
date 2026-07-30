defmodule EngineWeb.Plugs.VerifyServiceToken do
  @moduledoc """
  Autentica o tráfego interno vindo da api (Fase 7a, item 4).

  Espelho do `EngineServiceGuard` do lado da api: mesmo segredo compartilhado
  (`BRABO_SERVICE_TOKEN`), mesmo cabeçalho, mesma aceitação do
  `BRABO_SERVICE_TOKEN_PREVIOUS` durante a rotação.

  ## O que substituiu

  Até o corte, isto validava um JWT client-credentials do Keycloak: assinatura
  por JWKS remoto, expiração, issuer, e depois o claim `azp`. Removido o
  Keycloak, sobrariam JWKS sem emissor e uma dependência de rede no caminho de
  toda chamada interna. Um segredo comparado em tempo constante entrega a mesma
  garantia entre dois serviços que já compartilham o mesmo Secret.

  ## O contrato de resposta é 401, e importa

  `route_surface_test.exs` tem três asserções que dizem "toda rota fora da
  lista recusa requisição sem token" comparando com 401. Responder 403 aqui —
  que seria defensável, já que o token é sobre autorização de serviço —
  quebraria as três de uma vez.
  """

  import Plug.Conn

  require Logger

  @cabecalho "x-brabo-service-token"

  def init(opts), do: opts

  def call(conn, _opts) do
    with [apresentado] <- get_req_header(conn, @cabecalho),
         true <- confere?(apresentado) do
      conn
    else
      _ -> recusar(conn)
    end
  end

  defp recusar(conn) do
    # A recusa não deixava linha nenhuma (ADR 0035). Consequência: token mal
    # configurado num deploy e varredura contra `/internal` eram igualmente
    # invisíveis — o sintoma de ambos é a api "não conseguir falar com o engine",
    # sem nada no log dizendo que a porta respondeu 401.
    #
    # O token apresentado NÃO é logado, nem truncado: é segredo, e o CLAUDE.md
    # proíbe. O que interessa é a rota e a origem.
    Logger.warning(
      "token de serviço recusado em #{conn.method} #{conn.request_path} " <>
        "(origem #{origem(conn)})"
    )

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(401, Jason.encode!(%{error: "token de serviço inválido ou ausente"}))
    |> halt()
  end

  defp origem(conn) do
    case get_req_header(conn, "x-forwarded-for") do
      [valor | _] -> valor
      [] -> conn.remote_ip |> :inet.ntoa() |> to_string()
    end
  rescue
    _ -> "desconhecida"
  end

  # `Plug.Crypto.secure_compare/2` e não `==`: comparação byte a byte com saída
  # antecipada vaza o segredo para quem medir o tempo, e esta rota aceita
  # tentativa repetida sem custo — que é a condição que torna o ataque prático.
  defp confere?(apresentado) do
    secure_compare?(apresentado, atual()) or
      case anterior() do
        nil -> false
        valor -> secure_compare?(apresentado, valor)
      end
  end

  defp secure_compare?(a, b) when is_binary(a) and is_binary(b) do
    Plug.Crypto.secure_compare(a, b)
  end

  defp atual, do: Application.fetch_env!(:engine, :service_token)

  # Durante a rotação as duas pontas podem ser atualizadas em qualquer ordem,
  # sem janela em que uma recusa a outra. Igual à passphrase do JWT na api.
  defp anterior do
    case Application.get_env(:engine, :service_token_previous) do
      nil -> nil
      "" -> nil
      valor -> if valor == atual(), do: nil, else: valor
    end
  end
end
