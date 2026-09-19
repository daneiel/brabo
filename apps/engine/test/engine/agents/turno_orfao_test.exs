defmodule Engine.Agents.TurnoOrfaoTest do
  @moduledoc """
  RN-586 (AT-156): o engine reiniciou no MEIO de um turno. O `agent.status:
  working` já estava gravado (RN-578) e o processo do agente, com a Task do
  turno, morreu junto — então nada mais grava o fim. Sem esta regra o log ficava
  com `working` como último status do agente para sempre: a faixa da tela não
  sai e o `GetSessionPendingWorkUseCase` conta a pendência eternamente.

  Estes testes simulam o reinício do jeito determinístico: o log (fake) tem o
  `working` e NENHUM processo do agente existe; sobe-se o servidor de novo pelo
  `init/1` de verdade, e o que se afirma é o que o log durável recebe.
  """
  use Engine.DataCase, async: false

  alias Engine.Agents.{
    ArquitetoServer,
    CriativoServer,
    DevLeadServer,
    PoServer,
    StaffServer,
    TurnoOrfao,
    UxDesignerServer
  }

  alias Engine.Sessions.FakeEngineApiClient

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-orfao-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
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

  defp status(agente, valor),
    do: %{
      "type" => "agent.status",
      "actor" => %{"kind" => "agent", "id" => agente},
      "payload" => %{"status" => valor}
    }

  defp eventos_gravados(acc \\ []) do
    receive do
      {:event_appended, _, _, evento} -> eventos_gravados([evento | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end

  @seis [
    {CriativoServer, "criativo"},
    {PoServer, "po"},
    {ArquitetoServer, "arquiteto"},
    {DevLeadServer, "dev-lead"},
    {UxDesignerServer, "ux-designer"},
    {StaffServer, "staff"}
  ]

  for {modulo, agente} <- @seis do
    test "#{agente}: sobe sobre um `working` sem turno vivo e grava agent.error infra + idle" do
      Process.put(:fake_events, [status(unquote(agente), "working")])

      {:ok, _state} = unquote(modulo).init({Ecto.UUID.generate(), Ecto.UUID.generate()})

      assert [erro, idle] = eventos_gravados()
      assert erro.type == "agent.error"
      assert erro.actorId == unquote(agente)
      assert erro.payload.origem == "infra"
      assert erro.payload.reason == "turno_interrompido_por_reinicio"
      assert erro.payload.mensagem =~ "reiniciado"
      assert idle.type == "agent.status"
      assert idle.actorId == unquote(agente)
      assert idle.payload == %{status: "idle"}
    end

    test "#{agente}: não roda o turno de novo (nenhuma chamada ao LLM)" do
      Process.put(:fake_events, [status(unquote(agente), "working")])
      {:ok, state} = unquote(modulo).init({Ecto.UUID.generate(), Ecto.UUID.generate()})

      assert state.turno_assincrono == nil
      refute_received {:llm_turn, _, _, _, _, _}
    end
  end

  test "último status idle: nada a fechar" do
    Process.put(:fake_events, [status("po", "working"), status("po", "idle")])
    {:ok, _} = PoServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})
    assert eventos_gravados() == []
  end

  test "awaiting_approval NÃO é turno órfão (o Dev Lead suspenso é decisão pendente)" do
    Process.put(:fake_events, [
      status("dev-lead", "working"),
      status("dev-lead", "awaiting_approval")
    ])

    {:ok, _} = DevLeadServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})
    assert eventos_gravados() == []
  end

  test "o working de OUTRO agente não é fechado pelo init deste" do
    Process.put(:fake_events, [status("criativo", "working")])
    {:ok, _} = PoServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})
    assert eventos_gravados() == []
  end

  test "varrer/2 (boot) fecha só os agentes sem processo vivo, todos de uma leitura" do
    session_id = Ecto.UUID.generate()

    Process.put(:fake_events, [
      status("criativo", "working"),
      status("po", "working"),
      status("staff", "working"),
      status("staff", "idle")
    ])

    {:ok, _} = Registry.register(Engine.Sessions.Registry, "po:" <> session_id, nil)

    assert ["criativo"] = TurnoOrfao.varrer(Ecto.UUID.generate(), session_id)

    assert [erro, idle] = eventos_gravados()
    assert erro.actorId == "criativo"
    assert idle.actorId == "criativo"
  end

  test "leitura do log falhou: não grava nada e não derruba a subida" do
    Process.put(:fake_events_error, :econnrefused)
    assert {:ok, _} = PoServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})
    assert eventos_gravados() == []
  end

  test "escrita recusada pela api (sessão encerrada): não derruba a subida" do
    Process.put(:fake_events, [status("po", "working")])
    Process.put(:fake_append_event_error, {409, %{}})
    assert {:ok, _} = PoServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})
  end
end
