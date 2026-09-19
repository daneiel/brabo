defmodule EngineWeb.AgentCommandControllerTest do
  # async: false — mexe no Registry global de sessões e no Application env. As
  # actions são chamadas DIRETO (sem passar pelo router): o que está sob teste
  # é a decisão do controller, não o pipeline de auth.
  use EngineWeb.ConnCase, async: false

  alias Engine.Agents.{CriativoSupervisor, PoServer, PoSupervisor}
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

  # ADR 0163 (RN-578). O defeito medido: três cliques de 97,3 s, 97,3 s e
  # 51,8 s numa instalação real, cada um esperando o turno inteiro.
  describe "a resposta é o ACEITE, e a recusa não é mais calada" do
    test "202 com o turno do agente AINDA rodando", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      {:ok, pid, _origin} = PoSupervisor.start_agent(session_id, project_id)
      drenar_kickoff(pid)
      # `:sys.replace_state/2` roda a função DENTRO do processo do PO — é o
      # dicionário dele que a Task do turno herda.
      :sys.replace_state(pid, fn s ->
        Process.put(:fake_llm_turn_stream_hang, true)
        s
      end)

      conn =
        AgentCommandController.message(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "po",
          "text" => "e o cadastro?"
        })

      assert conn.status == 202
      # O turno começou e está PRESO — e a resposta já voltou.
      assert_receive :turno_pendurado, 1_000
      assert %{turno_assincrono: %{task: %Task{}}} = :sys.get_state(pid)

      GenServer.cast(pid, :cancel)
      _ = :sys.get_state(pid)
    end

    test "turno já em curso: 409 nomeado, não 202", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      {:ok, pid, _origin} = PoSupervisor.start_agent(session_id, project_id)
      drenar_kickoff(pid)

      :sys.replace_state(pid, fn s ->
        Process.put(:fake_llm_turn_stream_hang, true)
        s
      end)

      primeira =
        AgentCommandController.message(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "po",
          "text" => "primeira"
        })

      assert primeira.status == 202
      assert_receive :turno_pendurado, 1_000

      segunda =
        AgentCommandController.message(build_conn(), %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "po",
          "text" => "Continue"
        })

      assert %{"motivo" => "turno_em_andamento", "error" => mensagem} =
               json_response(segunda, 409)

      assert mensagem =~ "não foi lida"

      GenServer.cast(pid, :cancel)
      _ = :sys.get_state(pid)
    end

    test "readiness sem regra de negócio: 422 nomeado", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      {:ok, _pid} = CriativoSupervisor.start_agent(session_id, project_id)

      conn = AgentCommandController.readiness(conn, %{"sessionId" => session_id})

      assert %{"motivo" => "sem_regra_de_negocio"} = json_response(conn, 422)
    end
  end

  # O kickoff do PO sobe um turno no start FRESCO; espera ele fechar para o
  # teste partir de um agente ocioso.
  defp drenar_kickoff(pid) do
    Enum.reduce_while(1..100, nil, fn _, _ ->
      case :sys.get_state(pid) do
        %{turno_assincrono: nil} ->
          {:halt, :ok}

        _ ->
          Process.sleep(20)
          {:cont, nil}
      end
    end)
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
