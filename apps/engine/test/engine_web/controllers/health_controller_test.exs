defmodule EngineWeb.HealthControllerTest do
  @moduledoc """
  As três probes da Fase 5. O que cada teste protege:

  - `/live` NÃO pode depender do banco. Se um dia alguém "unificar" as probes,
    um Postgres lento passa a reiniciar todas as réplicas ao mesmo tempo.
  - `/ready` NÃO pode liberar tráfego antes da reidratação. É a regra que hoje
    depende da ordem da árvore de supervisão; aqui ela vira afirmação.
  """

  use EngineWeb.ConnCase, async: false

  alias Engine.Readiness

  setup do
    # Cada teste parte de um nó "recém-bootado", sem estágio marcado. O estado
    # é de nó (persistent_term), não de processo: precisa ser restaurado.
    Readiness.reset()
    on_exit(fn -> Enum.each([:sessions, :dev_agents], &Readiness.mark/1) end)
    :ok
  end

  describe "GET /live" do
    test "responde ok sem tocar o banco", %{conn: conn} do
      # Nenhum estágio marcado e sandbox sem checkout explícito: se o liveness
      # consultasse o Repo, este teste falharia — que é exatamente o ponto.
      conn = get(conn, ~p"/live")

      assert %{"service" => "engine", "status" => "ok"} = json_response(conn, 200)
    end

    test "continua ok mesmo antes da reidratação terminar", %{conn: conn} do
      refute Readiness.ready?()

      assert %{"status" => "ok"} = conn |> get(~p"/live") |> json_response(200)
    end
  end

  describe "GET /ready" do
    test "nega enquanto a reidratação não terminou, dizendo o que falta", %{conn: conn} do
      Readiness.mark(:sessions)

      body = conn |> get(~p"/ready") |> json_response(503)

      assert body["status"] == "error"
      assert body["details"]["reason"] == "rehydrating"
      assert body["details"]["pending"] == ["dev_agents"]
    end

    test "nega com NENHUM estágio concluído", %{conn: conn} do
      body = conn |> get(~p"/ready") |> json_response(503)

      assert body["details"]["reason"] == "rehydrating"
      assert Enum.sort(body["details"]["pending"]) == ["dev_agents", "sessions"]
    end

    test "libera depois que os dois reidratadores concluíram", %{conn: conn} do
      Readiness.mark(:sessions)
      Readiness.mark(:dev_agents)

      assert %{"status" => "ok"} = conn |> get(~p"/ready") |> json_response(200)
    end
  end

  describe "GET /health" do
    test "segue com o contrato original (a imagem e o docker/smoke.sh dependem)", %{conn: conn} do
      assert %{"service" => "engine", "status" => "ok"} =
               conn |> get(~p"/health") |> json_response(200)
    end
  end
end
