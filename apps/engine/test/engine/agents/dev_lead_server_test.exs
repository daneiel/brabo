defmodule Engine.Agents.DevLeadServerTest do
  # DataCase — o DevLeadServer monta o system prompt via o harness (lê o
  # banco). async: false (Application env global). Callbacks exercitados
  # DIRETO no processo de teste, como no ArquitetoServerTest.
  use Engine.DataCase, async: false

  alias Engine.Agents.DevLeadServer
  alias Engine.Sessions.FakeEngineApiClient
  import Engine.Agents.TurnoAssincronoCase, only: [sync_cast: 3, sync_call: 3]

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-devlead-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
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

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()
    {:ok, state} = DevLeadServer.init({session_id, project_id})
    %{state: state}
  end

  defp plano_turn(resumo) do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [
          %{
            "id" => "call-#{System.unique_integer([:positive])}",
            "name" => "propose_execution_plan",
            "arguments" => %{
              "modulos" => [
                %{"modulo" => "api", "agentes" => 1, "porque" => "uma história"}
              ],
              "resumo" => resumo
            }
          }
        ]
      },
      "usage" => %{"estimated" => true},
      "error" => nil
    }
  end

  defp eventos_de_plano do
    receber_planos([])
  end

  defp receber_planos(acc) do
    receive do
      {:event_appended, _p, _s, %{type: "execution.plan_proposed"} = ev} ->
        receber_planos([ev | acc])

      {:event_appended, _p, _s, _outro} ->
        receber_planos(acc)
    after
      0 -> Enum.reverse(acc)
    end
  end

  test "o plano ENCERRA o turno: um só `execution.plan_proposed`", %{state: state} do
    # Achado da primeira execução real do Dev Lead. O modelo, deixado no laço,
    # propôs de novo: ficaram DOIS planos na mesma sessão, com textos
    # diferentes e o mesmo total — e o event log é imutável, então nada dizia
    # qual valia.
    #
    # `fake_llm_always` devolve SEMPRE a mesma chamada de ferramenta: se o
    # laço não parar sozinho, ele só para no teto de iterações, e o teste vê
    # vários eventos.
    Process.put(:fake_llm_always, plano_turn("um agente na api"))

    assert {:noreply, _} = sync_cast(DevLeadServer, :kickoff, state)

    assert length(eventos_de_plano()) == 1,
           "o laço voltou ao modelo depois do plano e ele propôs de novo"
  end

  test "o plano recusado NÃO encerra o turno — o modelo pode corrigir", %{
    state: state
  } do
    # A contrapartida do teste acima, e o que impede a correção de virar
    # "parou no primeiro erro": plano inválido devolve tool-result de erro, o
    # laço continua, e o turno seguinte pode chegar num plano válido.
    invalido =
      put_in(
        plano_turn("vazio")["message"]["toolCalls"],
        [
          %{
            "id" => "call-ruim",
            "name" => "propose_execution_plan",
            "arguments" => %{"modulos" => [], "resumo" => "sem módulo"}
          }
        ]
      )

    Process.put(:fake_llm_turns, [
      invalido,
      plano_turn("agora vai"),
      FakeEngineApiClient.final_response("plano registrado")
    ])

    assert {:noreply, _} = sync_cast(DevLeadServer, :kickoff, state)

    # UM evento: o inválido não gravou nada, o válido gravou e parou.
    assert length(eventos_de_plano()) == 1
  end

  # Achado do problema 2 (RN-146): o `agent.response` carrega o nome do
  # modelo que gerou a resposta, extraído do frame `final` da api.
  test "agent.response carrega o nome do modelo", %{state: state} do
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("Plano registrado.", "claude-haiku")
    ])

    assert {:reply, :ok, _} =
             sync_call(DevLeadServer, {:user_message, "e aí?"}, state)

    session_id = state.session_id

    assert_received {:event_appended, _, ^session_id,
                     %{
                       type: "agent.response",
                       payload: %{content: "Plano registrado.", modelName: "claude-haiku"}
                     }}
  end

  # A api narra budget/credencial/binding no PRÓPRIO frame final, e esse ramo
  # devolvia `{state, ""}` — uma TUPLA onde todos os outros ramos devolvem o
  # mapa do state. `TurnoAssincrono.tratar_resultado/2` faz `Map.put/3` no que a
  # task devolveu: numa tupla isso é `BadMapError` dentro do `handle_info`, e o
  # agente (`restart: :temporary`) morria sem voltar. Aqui o ciclo COMPLETO
  # roda — `sync_call/3` passa pelo `handle_info` —, então a falha derrubaria o
  # teste. A prova a nível de PROCESSO está em `po_server_test.exs`.
  test "erro narrado no frame final vira agent.error e o turno fecha inteiro", %{state: state} do
    Process.put(:fake_llm_turns, [%{"error" => "Nenhuma credencial cadastrada para openrouter"}])

    assert {:reply, :ok, final_state} =
             sync_call(DevLeadServer, {:user_message, "e aí?"}, state)

    session_id = state.session_id

    assert_received {:event_appended, _, ^session_id, %{type: "agent.error", payload: payload}}
    assert payload.origem == "politica"
    assert payload.mensagem =~ "credencial"

    # O ramo devolveu o formato certo, e não foi a segunda barreira do
    # `TurnoAssincrono` que salvou o agente — ela narraria com origem `codigo`.
    refute_received {:event_appended, _, _, %{type: "agent.error", payload: %{origem: "codigo"}}}

    assert final_state.turno_assincrono == nil
  end
end
