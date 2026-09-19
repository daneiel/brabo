defmodule EngineWeb.AgentCommandControllerTest do
  # async: false — mexe no Registry global de sessões e no Application env. As
  # actions são chamadas DIRETO (sem passar pelo router): o que está sob teste
  # é a decisão do controller, não o pipeline de auth.
  use EngineWeb.ConnCase, async: false

  alias Engine.Agents.{Areas, CriativoServer, CriativoSupervisor, PoServer, PoSupervisor}
  alias Engine.Infra.InfraLeadServer
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

  # RN-587 (AT-132). A api grava o `chat.message` ANTES de perguntar ao engine;
  # o 422 deixava a mensagem no fio com cara de entregue e a frase só no toast.
  describe "a recusa de mensagem fica no fio (RN-587)" do
    test "infra: agent.error durável, origem politica, com a frase e o motivo", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      conn =
        AgentCommandController.message(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "infra",
          "text" => "sobe o container"
        })

      assert %{"error" => frase} = json_response(conn, 422)

      assert_receive {:event_appended, ^project_id, ^session_id,
                      %{type: "agent.error", actorKind: "agent", actorId: "infra", payload: p}}

      assert p.origem == "politica"
      assert p.reason == "agente_sem_conversa"
      assert p.mensagem == frase
    end

    test "nome desconhecido: o ator é o engine, nunca o nome vindo da rota", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      AgentCommandController.message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "<script>",
        "text" => "oi"
      })

      assert_receive {:event_appended, _, _,
                      %{type: "agent.error", actorKind: "system", actorId: "engine"}}
    end

    test "conversacional sem texto: agent.error com mensagem_sem_texto", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      AgentCommandController.message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "po"
      })

      assert_receive {:event_appended, _, _,
                      %{type: "agent.error", payload: %{reason: "mensagem_sem_texto"}}}
    end

    test "sem agent no corpo: agent.error com agente_ausente", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      AgentCommandController.message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "text" => "oi"
      })

      assert_receive {:event_appended, _, _,
                      %{type: "agent.error", payload: %{reason: "agente_ausente"}}}
    end

    test "sem projectId no corpo: recusa só como resposta, nada é gravado", %{conn: conn} do
      conn = AgentCommandController.message(conn, %{"agent" => "infra", "text" => "oi"})
      assert conn.status == 422
      refute_receive {:event_appended, _, _, _}, 100
    end
  end

  # RN-584 (AT-098). O defeito medido: a última cláusula de `message/2` não
  # olhava o agente, e uma mensagem ao `infra` era lida pelo CRIATIVO.
  describe "message/2 não tem destinatário padrão (RN-584)" do
    test "o Criativo recebe pela cláusula PRÓPRIA: 202 e o turno é dele", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      {:ok, pid} = CriativoSupervisor.start_agent(session_id, project_id)

      :sys.replace_state(pid, fn s ->
        Process.put(:fake_llm_turn_stream_hang, true)
        s
      end)

      conn =
        AgentCommandController.message(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "criativo",
          "text" => "quero um app de agenda"
        })

      assert conn.status == 202
      assert_receive :turno_pendurado, 1_000
      assert %{turno_assincrono: %{task: %Task{}}} = :sys.get_state(pid)

      GenServer.cast(pid, :cancel)
      _ = :sys.get_state(pid)
    end

    test "infra: 422 nomeado, e NINGUÉM lê — nem o Criativo, nem o Infra Lead", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      conn =
        AgentCommandController.message(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "infra",
          "text" => "sobe o container"
        })

      assert %{"motivo" => "agente_sem_conversa", "error" => mensagem} =
               json_response(conn, 422)

      assert mensagem =~ "Infra Lead"
      assert mensagem =~ "nenhum agente a leu"
      assert GenServer.whereis(CriativoServer.via(session_id)) == nil
      assert GenServer.whereis(InfraLeadServer.via(session_id)) == nil
    end

    # A enumeração vem do catálogo de áreas (GERADO de `agent-areas.ts`, a
    # fonte da api), mais os agentes do roster que não são de área e não
    # conversam, mais um nome que ninguém conhece. A guarda que compara com o
    # que a TELA oferece mora em `scripts/ci/destinos-do-composer.spec.ts` —
    # ExUnit não lê TypeScript.
    test "todo nome sem cláusula é 422 nomeado, e o Criativo nunca sobe", %{
      project_id: project_id,
      session_id: session_id
    } do
      das_areas =
        Enum.flat_map(Areas.all(), fn area -> [area.lead | area.members] end)

      fora_de_conversa =
        (das_areas ++ ~w(secops psicologo anamnese dev-backend agente-que-nao-existe))
        |> Enum.uniq()
        |> Enum.reject(&(&1 == "dev-lead"))

      for agente <- fora_de_conversa do
        conn =
          AgentCommandController.message(build_conn(), %{
            "sessionId" => session_id,
            "projectId" => project_id,
            "agent" => agente,
            "text" => "oi"
          })

        assert %{"motivo" => "agente_sem_conversa"} = json_response(conn, 422),
               "#{agente} não foi recusado com nome"
      end

      assert GenServer.whereis(CriativoServer.via(session_id)) == nil
    end

    test "sem agent no corpo: 422 agente_ausente, e o Criativo não sobe", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      conn =
        AgentCommandController.message(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "text" => "oi"
        })

      assert %{"motivo" => "agente_ausente"} = json_response(conn, 422)
      assert GenServer.whereis(CriativoServer.via(session_id)) == nil
    end

    test "agente que conversa, mas sem texto: 422 próprio, não 'não conversa'", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      conn =
        AgentCommandController.message(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "po"
        })

      assert %{"motivo" => "mensagem_sem_texto"} = json_response(conn, 422)
    end

    test "cancel sem agent: 422 agente_ausente, nunca o Criativo por padrão", %{
      conn: conn,
      session_id: session_id
    } do
      conn = AgentCommandController.cancel(conn, %{"sessionId" => session_id})

      assert %{"motivo" => "agente_ausente"} = json_response(conn, 422)
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
