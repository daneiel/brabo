defmodule EngineWeb.AgentCommandControllerTest do
  # async: false — mexe no Registry global de sessões e no Application env. As
  # actions são chamadas DIRETO (sem passar pelo router): o que está sob teste
  # é a decisão do controller, não o pipeline de auth.
  use EngineWeb.ConnCase, async: false

  alias Engine.Agents.{PoServer, PoSupervisor}
  alias Engine.Sessions.FakeEngineApiClient
  alias EngineWeb.AgentCommandController

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-agent-cmd-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    %{project_id: Ecto.UUID.generate(), session_id: Ecto.UUID.generate()}
  end

  describe "revise — devolução de história recusada (Fase 12c, RN-048)" do
    test "PO de pé: 202 e o PO recebe a devolução", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      {:ok, _pid, _origin} = PoSupervisor.start_agent(session_id, project_id)
      Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("ok")])

      conn =
        AgentCommandController.revise(conn, %{
          "sessionId" => session_id,
          "storyId" => "story-1",
          "title" => "Cadastro",
          "reason" => "Falta o caso de recusa"
        })

      assert conn.status == 202
      assert PoServer.vivo?(session_id)
    end

    test "PO morto: 404, não 500", %{conn: conn, session_id: session_id} do
      # A recusa JÁ foi gravada na api quando esta chamada acontece. Se o PO
      # morreu num restart do engine no meio do caminho, a api precisa
      # distinguir "não notifiquei" de "explodi" — sem a checagem de liveness
      # o `GenServer.call` sairia por `:noproc` e isto seria um 500.
      refute PoServer.vivo?(session_id)

      conn =
        AgentCommandController.revise(conn, %{
          "sessionId" => session_id,
          "storyId" => "story-1",
          "title" => "Cadastro",
          "reason" => "qualquer"
        })

      assert conn.status == 404
      assert %{"error" => mensagem} = json_response(conn, 404)
      assert mensagem =~ "não está de pé"
    end
  end
end
