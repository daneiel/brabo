defmodule EngineWeb.MetricsControllerTest do
  @moduledoc """
  O endpoint de scrape e, principalmente, o NOME da série.

  `oban_queue_depth` e os rótulos `queue`/`state` são referenciados por string
  em três lugares fora do Elixir: a regra do prometheus-adapter, o
  `spec.metrics` do HPA do engine e o smoke de Kubernetes. Renomear a métrica
  compila, passa em todo o resto da suite, e o único sintoma em produção é o
  HPA parar em `<unknown>` sem escalar — em silêncio. Este teste é o que
  transforma isso em suite vermelha.
  """

  use EngineWeb.ConnCase, async: false

  alias Engine.Telemetry.ObanQueueDepth

  test "expõe oban_queue_depth com os rótulos que o HPA seleciona", %{conn: conn} do
    ObanQueueDepth.measure()

    body = conn |> get(~p"/metrics") |> response(200)

    assert body =~ "oban_queue_depth",
           "o HPA do engine e a regra do prometheus-adapter referenciam este nome por string"

    assert body =~ ~r/oban_queue_depth\{[^}]*queue="default"/
    assert body =~ ~r/oban_queue_depth\{[^}]*state="available"/
  end

  test "responde em text/plain, que é o que o Prometheus aceita", %{conn: conn} do
    conn = get(conn, ~p"/metrics")

    assert response(conn, 200)
    assert ["text/plain" <> _] = get_resp_header(conn, "content-type")
  end
end
