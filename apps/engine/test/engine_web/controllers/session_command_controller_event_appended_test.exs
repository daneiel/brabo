defmodule EngineWeb.SessionCommandControllerEventAppendedTest do
  @moduledoc """
  AT-157 (RN-579): a api pede o `event.appended` de uma escrita que ela mesma
  fez. A action é chamada DIRETO, sem o pipeline de auth (testado à parte),
  como nos outros controllers de comando.
  """

  use EngineWeb.ConnCase, async: true

  alias EngineWeb.SessionCommandController

  test "caminho feliz: o canal da sessão recebe event.appended só com tipo e ator", %{conn: conn} do
    session_id = "sessao-" <> Integer.to_string(System.unique_integer([:positive]))
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)

    conn =
      SessionCommandController.event_appended(conn, %{
        "sessionId" => session_id,
        "type" => "proposed_action.approved",
        "actorId" => "user-1"
      })

    assert conn.status == 204

    assert_receive %Phoenix.Socket.Broadcast{
      event: "event.appended",
      payload: %{type: "proposed_action.approved", actorId: "user-1"} = payload
    }

    refute Map.has_key?(payload, :payload)
  end

  test "sem type: 400 e nada é avisado", %{conn: conn} do
    session_id = "sessao-" <> Integer.to_string(System.unique_integer([:positive]))
    Phoenix.PubSub.subscribe(Engine.PubSub, "session:" <> session_id)

    conn = SessionCommandController.event_appended(conn, %{"sessionId" => session_id})

    assert conn.status == 400
    refute_receive %Phoenix.Socket.Broadcast{event: "event.appended"}, 100
  end
end
