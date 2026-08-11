defmodule Engine.Agents.DevLeadServerTest do
  # DataCase — o DevLeadServer monta o system prompt via o harness (lê o
  # banco). async: false (Application env global). Callbacks exercitados
  # DIRETO no processo de teste, como no ArquitetoServerTest.
  use Engine.DataCase, async: false

  alias Engine.Agents.DevLeadServer
  alias Engine.Sessions.FakeEngineApiClient
  import Engine.Agents.TurnoAssincronoCase, only: [sync_cast: 3]

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
end
