defmodule EngineWeb.SessionSocketTest do
  @moduledoc """
  RN-108: `connect/3` exige `params["ticket"]` válido — a conexão inteira é
  recusada sem ele, não só o join do canal (que tinha, e continua tendo,
  barreira própria — ver `SessionChannelTest`).
  """

  use EngineWeb.ChannelCase, async: true

  alias Engine.Sessions.SocketTicket

  defp insert_ticket!(ticket_bruto, attrs) do
    hash = :sha256 |> :crypto.hash(ticket_bruto) |> Base.encode16(case: :lower)

    defaults = %{
      id: Ecto.UUID.generate(),
      session_id: Ecto.UUID.generate(),
      project_id: Ecto.UUID.generate(),
      user_id: Ecto.UUID.generate(),
      scope: "heartbeat",
      ticket_hash: hash,
      expires_at: DateTime.add(DateTime.utc_now(), 30, :second),
      consumed_at: nil,
      created_at: DateTime.utc_now()
    }

    linha = Map.merge(defaults, attrs)

    %SocketTicket{}
    |> Ecto.Changeset.change(linha)
    |> Engine.Repo.insert!()

    linha
  end

  test "SEM ticket, a conexão é recusada" do
    assert {:error, %{reason: "unauthorized"}} =
             connect(EngineWeb.SessionSocket, %{})
  end

  test "com ticket vazio, a conexão é recusada" do
    assert {:error, %{reason: "unauthorized"}} =
             connect(EngineWeb.SessionSocket, %{"ticket" => ""})
  end

  test "com ticket que não existe, a conexão é recusada" do
    assert {:error, %{reason: "unauthorized"}} =
             connect(EngineWeb.SessionSocket, %{"ticket" => "nunca-existiu"})
  end

  test "com ticket expirado, a conexão é recusada" do
    ticket = "ticket-expirado"
    insert_ticket!(ticket, %{expires_at: DateTime.add(DateTime.utc_now(), -1, :second)})

    assert {:error, %{reason: "unauthorized"}} =
             connect(EngineWeb.SessionSocket, %{"ticket" => ticket})
  end

  test "com ticket já consumido, a conexão é recusada — reuso" do
    ticket = "ticket-ja-usado"
    insert_ticket!(ticket, %{consumed_at: DateTime.utc_now()})

    assert {:error, %{reason: "unauthorized"}} =
             connect(EngineWeb.SessionSocket, %{"ticket" => ticket})
  end

  test "com ticket válido, conecta e guarda project_id/user_id/scope no assign" do
    ticket = "ticket-valido"
    linha = insert_ticket!(ticket, %{scope: "terminal"})

    assert {:ok, socket} = connect(EngineWeb.SessionSocket, %{"ticket" => ticket})

    assert socket.assigns.project_id == linha.project_id
    assert socket.assigns.user_id == linha.user_id
    assert socket.assigns.scope == "terminal"
    assert socket.assigns.ticket == ticket
  end
end
