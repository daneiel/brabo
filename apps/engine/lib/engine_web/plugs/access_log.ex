defmodule EngineWeb.Plugs.AccessLog do
  @moduledoc """
  Log de acesso HTTP do engine (ADR 0035).

  O endpoint não tinha `Plug.Logger`: nenhuma requisição que chegava ao engine
  deixava linha de log. Com 13 rotas `/internal` sendo o canal por onde a api
  comanda o engine, isso significava que "a api chamou?" não tinha resposta no
  log — só no Tempo, quando havia coletor.

  ## Por que não é o `Plug.Logger`

  Ele não filtra rota. As probes do Kubernetes e o scrape do Prometheus batem em
  `/health`, `/live` e `/metrics` a cada poucos segundos, para sempre — um log de
  acesso sem filtro enterraria as 13 rotas que interessam sob milhares de linhas
  idênticas, que é exatamente o problema que `rotaIgnorada` resolve do lado da api.
  Mesma disciplina, dos dois lados.

  Emite UMA linha por requisição, no fim, com status e duração.
  """

  require Logger

  @behaviour Plug

  @prefixos_ignorados ["/health", "/live", "/metrics"]

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(conn, _opts) do
    if ignorar?(conn.request_path) do
      conn
    else
      inicio = System.monotonic_time()

      Plug.Conn.register_before_send(conn, fn enviada ->
        duracao =
          System.convert_time_unit(System.monotonic_time() - inicio, :native, :microsecond)

        Logger.info(
          "#{enviada.method} #{enviada.request_path} → #{enviada.status} " <>
            "#{Float.round(duracao / 1000, 2)}ms"
        )

        enviada
      end)
    end
  end

  defp ignorar?(caminho) do
    Enum.any?(@prefixos_ignorados, &String.starts_with?(caminho, &1))
  end
end
