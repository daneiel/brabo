defmodule EngineWeb.AgentCommandControllerTest do
  # async: false — mexe no Registry global de sessões e no Application env. As
  # actions são chamadas DIRETO (sem passar pelo router): o que está sob teste
  # é a decisão do controller, não o pipeline de auth.
  use EngineWeb.ConnCase, async: false

  alias Engine.Agents.{Areas, CriativoServer, CriativoSupervisor, PoServer, PoSupervisor}
  alias Engine.Infra.{InfraLeadServer, InfraLeadSupervisor}
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

    # RN-673 (ADR 0191): até aqui a segunda mensagem era 409
    # `turno_em_andamento` e ficava gravada sem ser lida. Agora ela ENTRA NA
    # FILA: 202 também, com o corpo dizendo que espera e em que posição.
    test "turno já em curso: a mensagem entra na fila — 202 com entrega enfileirada", %{
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
          "text" => "Continue",
          "mensagemId" => "evt-continue"
        })

      assert %{"entrega" => "enfileirada", "posicao" => 1} = json_response(segunda, 202)

      assert [%{id: "evt-continue", texto: "Continue"}] = :sys.get_state(pid).fila_de_mensagens

      # Cancelar pela rota: o processo do agente decide (204), e a segunda vez
      # é 409 nomeado — ela já não está na fila.
      cancelada =
        AgentCommandController.cancel_queued_message(build_conn(), %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "po",
          "mensagemId" => "evt-continue",
          "userId" => "u-1"
        })

      assert cancelada.status == 204
      assert :sys.get_state(pid).fila_de_mensagens == []

      de_novo =
        AgentCommandController.cancel_queued_message(build_conn(), %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "po",
          "mensagemId" => "evt-continue",
          "userId" => "u-1"
        })

      assert %{"motivo" => "mensagem_fora_da_fila"} = json_response(de_novo, 409)

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
    # Até a RN-617 este caso era o `infra`; ele passou a conversar, e o nome do
    # roster que segue sem cláusula é o lead de QA.
    test "agente do roster sem conversa: agent.error durável, origem politica, com a frase e o motivo",
         %{
           conn: conn,
           project_id: project_id,
           session_id: session_id
         } do
      conn =
        AgentCommandController.message(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "qa",
          "text" => "roda os testes"
        })

      assert %{"error" => frase} = json_response(conn, 422)

      assert_receive {:event_appended, ^project_id, ^session_id,
                      %{type: "agent.error", actorKind: "system", actorId: "engine", payload: p}}

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
      conn = AgentCommandController.message(conn, %{"agent" => "qa", "text" => "oi"})
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

    # RN-617 (ADR 0175): o Infra Lead é o sétimo conversacional. Até ali esta
    # mensagem era 422 `agente_sem_conversa` e ninguém a lia.
    test "infra: cláusula PRÓPRIA — 202 no aceite, o turno é do Infra Lead e o Criativo não sobe",
         %{
           conn: conn,
           project_id: project_id,
           session_id: session_id
         } do
      {:ok, pid, _origin} = InfraLeadSupervisor.start_agent(session_id, project_id)

      :sys.replace_state(pid, fn s ->
        Process.put(:fake_llm_turn_stream_hang, true)
        s
      end)

      conn =
        AgentCommandController.message(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "infra",
          "text" => "sobe o container"
        })

      assert conn.status == 202
      assert_receive :turno_pendurado, 1_000
      assert %{turno_assincrono: %{task: %Task{}}} = :sys.get_state(pid)
      assert GenServer.whereis(CriativoServer.via(session_id)) == nil

      segunda =
        AgentCommandController.message(build_conn(), %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "infra",
          "text" => "Continue",
          "mensagemId" => "evt-infra"
        })

      # RN-673: entra na fila do Infra Lead, como na dos outros seis. Cancelada
      # aqui para o "Parar" abaixo não entregá-la num turno novo.
      assert %{"entrega" => "enfileirada"} = json_response(segunda, 202)

      assert AgentCommandController.cancel_queued_message(build_conn(), %{
               "sessionId" => session_id,
               "projectId" => project_id,
               "agent" => "infra",
               "mensagemId" => "evt-infra",
               "userId" => "u-1"
             }).status == 204

      # "Parar" alcança o Infra Lead (`via_for/2`) e mata o turno.
      parar =
        AgentCommandController.cancel(build_conn(), %{
          "sessionId" => session_id,
          "agent" => "infra"
        })

      assert parar.status == 202
      assert %{turno_assincrono: nil} = :sys.get_state(pid)
    end

    test "infra com o engine recém-reiniciado: a mensagem reergue o agente SEM kickoff", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      assert GenServer.whereis(InfraLeadServer.via(session_id)) == nil

      conn =
        AgentCommandController.message(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id,
          "agent" => "infra",
          "text" => "oi"
        })

      assert conn.status == 202
      pid = GenServer.whereis(InfraLeadServer.via(session_id))
      assert is_pid(pid)

      # O turno da mensagem fecha; o kickoff (que lê o contexto de infra) é do
      # handoff aceito (`start/2`), nunca desta rota.
      drenar_kickoff(pid)
      refute_received {:infra_context_fetched}
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
      das_areas = Enum.flat_map(Areas.all(), fn area -> [area.lead | area.members] end)

      fora_de_conversa =
        (das_areas ++ ~w(secops psicologo anamnese dev-backend agente-que-nao-existe))
        |> Enum.uniq()
        |> Enum.reject(&(&1 in ~w(dev-lead infra)))

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

  # RN-622 (AT-164): o idioma do AUTOR, resolvido pela api, viaja no comando e
  # chega ao modelo como a última mensagem de cada chamada do turno.
  describe "idiomaDaResposta no comando (RN-622)" do
    defp mandar_ao_criativo(conn, project_id, session_id, extra) do
      {:ok, _pid} = CriativoSupervisor.start_agent(session_id, project_id)

      AgentCommandController.message(
        conn,
        Map.merge(
          %{
            "sessionId" => session_id,
            "projectId" => project_id,
            "agent" => "criativo",
            "text" => "oi"
          },
          extra
        )
      )
    end

    test "o idioma do autor chega ao fim do que vai ao modelo", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      conn = mandar_ao_criativo(conn, project_id, session_id, %{"idiomaDaResposta" => "en"})

      assert conn.status == 202
      assert_receive {:llm_turn_stream, "criativo", enviado, _tools}, 2_000
      assert %{"role" => "system", "content" => "Respond in English" <> _} = List.last(enviado)
    end

    test "campo ausente ou que não é texto: a mensagem é aceita, sem orientação", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      conn = mandar_ao_criativo(conn, project_id, session_id, %{"idiomaDaResposta" => 42})

      assert conn.status == 202
      assert_receive {:llm_turn_stream, "criativo", enviado, _tools}, 2_000
      assert %{"role" => "user"} = List.last(enviado)
    end

    # RN-680 (ADR 0196): os fatos do perfil do autor viajam no mesmo comando e
    # entram como mensagem de sistema ANTES da orientação de idioma.
    test "perfilDoAutor chega ao modelo antes do idioma", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      conn =
        mandar_ao_criativo(conn, project_id, session_id, %{
          "idiomaDaResposta" => "en",
          "perfilDoAutor" => "Fatos do perfil: prefere uma pergunta por vez"
        })

      assert conn.status == 202
      assert_receive {:llm_turn_stream, "criativo", enviado, _tools}, 2_000
      assert %{"role" => "system", "content" => "Respond in English" <> _} = List.last(enviado)

      assert %{"role" => "system", "content" => "Fatos do perfil" <> _} = Enum.at(enviado, -2)
    end

    test "perfilDoAutor que não é texto: a mensagem é aceita, sem perfil", %{
      conn: conn,
      project_id: project_id,
      session_id: session_id
    } do
      conn =
        mandar_ao_criativo(conn, project_id, session_id, %{
          "idiomaDaResposta" => "en",
          "perfilDoAutor" => 42
        })

      assert conn.status == 202
      assert_receive {:llm_turn_stream, "criativo", enviado, _tools}, 2_000
      assert %{"role" => "system", "content" => "Respond in English" <> _} = List.last(enviado)
      assert %{"role" => "user"} = Enum.at(enviado, -2)
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
