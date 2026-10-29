defmodule Engine.Agents.RetomadaDosSeisTest do
  @moduledoc """
  AT-582 (L2): os seis conversacionais oferecem `registrar_plano` e retomam o
  turno interrompido no `init/1`, pelo MESMO caminho (`retomada_ao_subir/3`
  antes da fila). O teste passa pelo `init/1` de verdade de cada servidor.
  """
  use Engine.DataCase, async: false

  alias Engine.Agents.{
    ArquitetoServer,
    CriativoServer,
    DevLeadServer,
    PoServer,
    StaffServer,
    TurnoAssincrono,
    UxDesignerServer
  }

  alias Engine.Harness.RetomadaDoTurno
  alias Engine.Sessions.FakeEngineApiClient

  @seis [
    {CriativoServer, "criativo"},
    {PoServer, "po"},
    {ArquitetoServer, "arquiteto"},
    {DevLeadServer, "dev-lead"},
    {UxDesignerServer, "ux-designer"},
    {StaffServer, "staff"}
  ]

  setup do
    root = Path.join(System.tmp_dir!(), "brabo-retomada-#{System.unique_integer([:positive])}")
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

  defp ev(tipo, agente, payload, quando \\ nil) do
    base = %{
      "type" => tipo,
      "actor" => %{"kind" => "agent", "id" => agente},
      "payload" => payload
    }

    if quando, do: Map.put(base, "createdAt", quando), else: base
  end

  defp agora, do: DateTime.utc_now() |> DateTime.add(-5, :second) |> DateTime.to_iso8601()

  defp msg(texto), do: %{"type" => "chat.message", "payload" => %{"text" => texto}}

  for {modulo, agente} <- @seis do
    describe "#{agente}" do
      test "oferece registrar_plano e retoma o turno órfão recente, com a mensagem efêmera" do
        Process.put(:fake_events, [
          msg("faça o brief"),
          ev("agent.status", unquote(agente), %{"status" => "working"}),
          ev(
            "agent.plan",
            unquote(agente),
            %{
              "objetivo" => "fechar o brief",
              "passos" => [%{"texto" => "perguntar", "estado" => "em_curso"}]
            }
          ),
          ev("agent.turn_resumed", unquote(agente), %{}, agora())
        ])

        {:ok, state} = unquote(modulo).init({Ecto.UUID.generate(), Ecto.UUID.generate()})

        assert state.retomada_agendada
        assert "registrar_plano" in Enum.map(state.tool_specs, & &1.name)
        assert_received :retomar_turno_interrompido

        antes = Enum.count(state.messages, &(&1["role"] == "user"))
        me = self()
        real = state.montar_turno_de_retomada

        espiao = fn st ->
          turno = real.(st)

          fn ->
            send(me, {:efemera, RetomadaDoTurno.anexar([], unquote(agente))})
            turno.()
          end
        end

        state = Map.put(state, :montar_turno_de_retomada, espiao)
        assert {:ok, novo} = TurnoAssincrono.tratar_resultado(:retomar_turno_interrompido, state)
        assert %{task: _} = novo.turno_assincrono

        assert_receive {:efemera, [%{"role" => "system", "content" => c}]}, 2_000
        assert c =~ "fechar o brief"

        assert_receive {:llm_turn_stream, unquote(agente), mensagens, tools}, 2_000
        assert Enum.count(mensagens, &(&1["role"] == "user")) == antes
        assert "registrar_plano" in Enum.map(tools, &(&1[:name] || &1["name"]))
      end

      test "turno já retomado (working depois do turn_resumed) não retoma de novo" do
        Process.put(:fake_events, [
          ev("agent.turn_resumed", unquote(agente), %{}, agora()),
          ev("agent.status", unquote(agente), %{"status" => "working"})
        ])

        {:ok, state} = unquote(modulo).init({Ecto.UUID.generate(), Ecto.UUID.generate()})

        refute state.retomada_agendada
        refute_received :retomar_turno_interrompido
      end
    end
  end
end
