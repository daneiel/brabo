defmodule Engine.Sessions.EngineApiClientAvisoNoCanalTest do
  @moduledoc """
  AT-093 (RN-579): a fachada `EngineApiClient` avisa o canal `session:<id>`
  de toda escrita que a api CONFIRMOU, e só dela.

  É esse aviso que deixa a web trocar o poll de 3s por invalidação enquanto o
  canal está vivo. Antes, só `ArtifactEmitter` e o Infra Lead avisavam, à
  mão, e o resto das escritas (o `EventLog` do harness, o `AgentIo`, a
  proposta de ação, o handoff, o backlog do PO) chegava à tela só pelo poll.
  """
  use ExUnit.Case, async: false

  alias Engine.Sessions.{EngineApiClient, FakeEngineApiClient}

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    session_id = Ecto.UUID.generate()
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)
    %{session_id: session_id}
  end

  test "append confirmado avisa com o TIPO e o ator, e sem payload", %{session_id: sid} do
    :ok =
      EngineApiClient.append_event("proj-1", sid, %{
        type: "tool.result",
        actorKind: "agent",
        actorId: "dev-api",
        payload: %{output: String.duplicate("x", 10_000)}
      })

    assert_received %Phoenix.Socket.Broadcast{event: "event.appended", payload: payload}
    assert payload == %{type: "tool.result", actorId: "dev-api"}
  end

  test "append_event_returning confirmado também avisa", %{session_id: sid} do
    {:ok, _} =
      EngineApiClient.append_event_returning("proj-1", sid, %{
        type: "artifact.note",
        actorKind: "agent",
        actorId: "po",
        payload: %{}
      })

    assert_received %Phoenix.Socket.Broadcast{
      event: "event.appended",
      payload: %{type: "artifact.note", actorId: "po"}
    }
  end

  test "CASO DE FALHA: append RECUSADO pela api não avisa ninguém", %{session_id: sid} do
    Process.put(:fake_append_event_error, :recusado)

    {:error, :recusado} =
      EngineApiClient.append_event("proj-1", sid, %{
        type: "tool.call",
        actorKind: "agent",
        actorId: "dev-api",
        payload: %{}
      })

    refute_received %Phoenix.Socket.Broadcast{event: "event.appended"}
  end

  test "as escritas que a api registra como evento avisam pelo tipo durável", %{session_id: sid} do
    {:ok, _} =
      EngineApiClient.propose_action(
        "proj-1",
        sid,
        "terminal",
        %{kind: "agent", id: "dev-api"},
        %{
          command: "ls"
        }
      )

    assert_received %Phoenix.Socket.Broadcast{
      event: "event.appended",
      payload: %{type: "proposed_action.created", actorId: "dev-api"}
    }

    {:ok, _} = EngineApiClient.create_handoff("proj-1", sid, "criativo", "po", nil)

    assert_received %Phoenix.Socket.Broadcast{
      event: "event.appended",
      payload: %{type: "handoff.offered", actorId: "criativo"}
    }

    {:ok, _} = EngineApiClient.create_epic("proj-1", sid, %{title: "E"})
    {:ok, _} = EngineApiClient.create_task("proj-1", sid, %{title: "T"})

    assert_received %Phoenix.Socket.Broadcast{payload: %{type: "backlog.epic_created"}}
    assert_received %Phoenix.Socket.Broadcast{payload: %{type: "backlog.task_created"}}
  end

  test "sem sessão (session_id nil) não há canal a avisar, e nada quebra" do
    assert :ok =
             EngineApiClient.append_event("proj-1", nil, %{
               type: "runner.workspace_confirmed",
               actorKind: "system",
               actorId: "runner",
               payload: %{}
             })

    refute_received %Phoenix.Socket.Broadcast{}
  end
end
