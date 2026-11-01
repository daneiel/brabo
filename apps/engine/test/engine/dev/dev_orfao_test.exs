defmodule Engine.Dev.DevOrfaoTest do
  @moduledoc """
  RN-778 (AT-465): dev agent com `dev.working` como último evento e sem dono
  durável fecha por evento novo; o que tem linha em `dev_agent_states` nesta
  sessão (vivo, ou religado pelo `DevRehydrator`) não é tocado.
  """
  use Engine.DataCase, async: false

  alias Engine.Dev.{DevAgentState, DevOrfao}
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    :ok
  end

  defp dev(agente, tipo),
    do: %{"type" => tipo, "actor" => %{"kind" => "agent", "id" => agente}, "payload" => %{}}

  defp gravados(acc \\ []) do
    receive do
      {:event_appended, _, _, evento} -> gravados([evento | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end

  test "dev.working sem dono durável vira dev.error infra + dev.idle, nunca reexecuta" do
    Process.put(:fake_events, [dev("dev-api", "dev.started"), dev("dev-api", "dev.working")])

    assert ["dev-api"] = DevOrfao.varrer(Ecto.UUID.generate(), Ecto.UUID.generate())

    assert [erro, idle] = gravados()
    assert erro.type == "dev.error"
    assert erro.payload.origem == "infra"
    assert erro.payload.reason == "dev_agent_sem_processo"
    assert idle.type == "dev.idle"
    assert idle.actorId == "dev-api"
  end

  test "agente com linha durável nesta sessão não é órfão; idle posterior também não" do
    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    DevAgentState.upsert!(%{
      project_id: project_id,
      agent_id: "dev-api",
      module: "api",
      session_id: session_id,
      status: "working"
    })

    Process.put(:fake_events, [
      dev("dev-api", "dev.working"),
      dev("dev-web", "dev.working"),
      dev("dev-web", "dev.idle")
    ])

    assert [] = DevOrfao.varrer(project_id, session_id)
    assert [] = gravados()
  end

  test "leitura falha: nada é fechado" do
    Process.put(:fake_events_error, :timeout)

    assert [] = DevOrfao.varrer(Ecto.UUID.generate(), Ecto.UUID.generate())
    assert [] = gravados()
  end
end
