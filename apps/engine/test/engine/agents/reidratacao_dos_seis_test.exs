defmodule Engine.Agents.ReidratacaoDosSeisTest do
  @moduledoc """
  RN-580 nos SEIS conversacionais: cada um sobe pelo MESMO caminho
  (`Engine.Agents.Reidratacao`). O teste passa pelo `init/1` de verdade de cada
  servidor — é ele que prova que nenhum dos seis ficou com a cópia antiga de
  `rehydrate/2`, que lia o começo e ignorava pergunta e ferramenta.

  Também as leituras de kickoff que liam os PRIMEIROS 200 eventos de todos os
  tipos: o artefato que nasce DEPOIS do evento 200 tem de chegar.
  """

  use Engine.DataCase, async: false

  alias Engine.Agents.{
    ArquitetoServer,
    CriativoServer,
    DevLeadServer,
    PoServer,
    StaffServer,
    UxDesignerServer
  }

  alias Engine.Sessions.FakeEngineApiClient
  import Engine.Agents.TurnoAssincronoCase, only: [sync_call: 3, sync_cast: 3]

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-reidratacao-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
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

    :ok
  end

  defp msg(texto), do: %{"type" => "chat.message", "payload" => %{"text" => texto}}

  @seis [
    {CriativoServer, "criativo"},
    {PoServer, "po"},
    {ArquitetoServer, "arquiteto"},
    {DevLeadServer, "dev-lead"},
    {UxDesignerServer, "ux-designer"},
    {StaffServer, "staff"}
  ]

  for {modulo, agente} <- @seis do
    test "#{agente}: sobe com o FIM da conversa, o começo resumido com o número, e as próprias ferramentas" do
      Process.put(
        :fake_events,
        Enum.map(1..210, &msg("m#{&1}")) ++
          [
            %{
              "type" => "tool.call",
              "actor" => %{"kind" => "agent", "id" => unquote(agente)},
              "payload" => %{"tool" => "emit_artifact", "args" => %{"type" => "note"}}
            }
          ]
      )

      {:ok, state} = unquote(modulo).init({Ecto.UUID.generate(), Ecto.UUID.generate()})

      [prompt, resumo | cauda] = state.messages
      assert prompt[:pinned] == true
      assert resumo["role"] == "system"
      assert resumo["content"] =~ "11 evento(s) ANTERIORES aos 200 mais recentes"

      assert List.last(cauda)["content"] =~ "Chamei a ferramenta `emit_artifact`"
      assert Enum.at(cauda, -2)["content"] == "m210"
    end
  end

  test "PO: o product brief que nasce DEPOIS do evento 200 chega ao kickoff" do
    {:ok, state} = PoServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})

    Process.put(
      :fake_events,
      Enum.map(1..250, &msg("m#{&1}")) ++
        [
          %{
            "id" => "evt-brief",
            "type" => "artifact.product_brief",
            "payload" => %{"summary" => "App tardio de cadastro"}
          },
          %{
            "id" => "evt-r1",
            "type" => "artifact.business_rule",
            "payload" => %{"title" => "Regra tardia", "description" => "d"}
          }
        ]
    )

    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("ok")])

    assert {:noreply, novo} = sync_cast(PoServer, :kickoff, state)

    instrucao =
      novo.messages
      |> Enum.filter(&(&1["role"] == "user"))
      |> Enum.map_join("\n", & &1["content"])

    assert instrucao =~ "App tardio de cadastro"
    assert instrucao =~ "id=evt-r1 | Regra tardia"
    refute instrucao =~ "sem product brief"
  end

  test "Criativo: a regra capturada DEPOIS do evento 200 entra no brief (e a prontidão não é recusada)" do
    {:ok, state} = CriativoServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})

    Process.put(
      :fake_events,
      Enum.map(1..250, &msg("m#{&1}")) ++
        [%{"id" => "evt-tarde", "type" => "artifact.business_rule", "payload" => %{}}]
    )

    Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("Resumo")])

    assert {:reply, :ok, _} = sync_call(CriativoServer, :confirm_readiness, state)

    assert_received {:event_appended, _, _,
                     %{type: "artifact.product_brief", payload: %{"rules" => ["evt-tarde"]}}}
  end

  test "Arquiteto, Dev Lead e UX Designer leem o kickoff por tipo, pela cauda" do
    for {modulo, tipos} <- [
          {ArquitetoServer,
           ["artifact.product_brief", "artifact.business_rule", "backlog.story_created"]},
          {DevLeadServer, ["architecture.module_map_created", "backlog.story_created"]},
          {UxDesignerServer, ["artifact.product_brief"]}
        ] do
      {:ok, state} = modulo.init({Ecto.UUID.generate(), Ecto.UUID.generate()})
      Process.put(:fake_events, [])
      Process.put(:fake_list_events_calls, [])
      Process.put(:fake_llm_turns, [FakeEngineApiClient.final_response("ok")])

      sync_cast(modulo, :kickoff, state)

      assert [opts | _] = Process.get(:fake_list_events_calls), inspect(modulo)
      assert opts[:types] == tipos
      assert opts[:latest] == true
    end
  end
end
