defmodule EngineWeb.MetricsController do
  @moduledoc """
  Endpoint de scrape do Prometheus (Fase 5, item 3).

  Fica fora do pipeline `:internal` porque o Prometheus não carrega token do
  segredo de serviço — quem restringe o acesso é a NetworkPolicy, que só libera a porta
  4000 deste path para o namespace de monitoramento. Servir métrica sem
  autenticação numa rede sem política seria vazamento de topologia; com a
  política, o alcance é o mesmo de um `ClusterRole` de scrape.

  Serve do agregador em memória do `TelemetryMetricsPrometheus.Core`, montado
  por `EngineWeb.Telemetry`.
  """

  use EngineWeb, :controller

  def index(conn, _params) do
    metrics = TelemetryMetricsPrometheus.Core.scrape(EngineWeb.Telemetry.prometheus_name())

    conn
    |> put_resp_content_type("text/plain", nil)
    |> send_resp(200, metrics)
  end
end
