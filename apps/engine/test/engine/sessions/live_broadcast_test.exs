defmodule Engine.Sessions.LiveBroadcastTest do
  @moduledoc """
  `agent_status/4` broadcasta E PERSISTE (ADR 0021). ADR 0086/RN-284
  ampliou a guarda de status para aceitar `"awaiting_approval"` — o Dev
  Lead precisa emitir esse status quando o turno suspende esperando a
  decisão do plano de execução (`TurnoAssincrono.suspender/1`), e sem a
  guarda o `when` recusava silenciosamente qualquer status fora de
  `["working", "idle"]`.
  """
  use ExUnit.Case, async: false

  alias Engine.Sessions.{FakeEngineApiClient, LiveBroadcast}

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    session_id = Ecto.UUID.generate()
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)

    %{project_id: "proj-1", session_id: session_id}
  end

  describe "agent_status/4" do
    test "working e idle continuam aceitos (comportamento anterior)", %{
      project_id: project_id,
      session_id: session_id
    } do
      assert :ok = LiveBroadcast.agent_status(project_id, session_id, "dev-lead", "working")

      assert_received %Phoenix.Socket.Broadcast{
        event: "agent.status",
        payload: %{status: "working"}
      }

      assert :ok = LiveBroadcast.agent_status(project_id, session_id, "dev-lead", "idle")
      assert_received %Phoenix.Socket.Broadcast{event: "agent.status", payload: %{status: "idle"}}
    end

    test "awaiting_approval é aceito, broadcastado E persistido (ADR 0086)", %{
      project_id: project_id,
      session_id: session_id
    } do
      assert :ok =
               LiveBroadcast.agent_status(project_id, session_id, "dev-lead", "awaiting_approval")

      assert_received %Phoenix.Socket.Broadcast{
        event: "agent.status",
        payload: %{status: "awaiting_approval"}
      }

      assert_received {:event_appended, ^project_id, ^session_id, event}
      assert event.type == "agent.status"
      assert event.actorId == "dev-lead"
      assert event.payload.status == "awaiting_approval"
    end

    test "status fora da lista aceita não casa nenhuma cláusula (FunctionClauseError)", %{
      project_id: project_id,
      session_id: session_id
    } do
      assert_raise FunctionClauseError, fn ->
        LiveBroadcast.agent_status(project_id, session_id, "dev-lead", "quem_sabe")
      end
    end
  end
end
