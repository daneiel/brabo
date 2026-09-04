defmodule EngineWeb.RunnerSocketTest do
  @moduledoc """
  Réplica do RN-108 para o socket `/runner`: `connect/3` exige
  `params["ticket"]` válido — a conexão inteira é recusada sem ele, não só o
  join do canal (que tem barreira própria — ver `TerminalChannelTest`).
  """

  use EngineWeb.ChannelCase, async: true

  alias Engine.Runners.SocketTicket

  test "SEM ticket, a conexão é recusada" do
    assert {:error, %{reason: "unauthorized"}} = connect(EngineWeb.RunnerSocket, %{})
  end

  test "com ticket vazio, a conexão é recusada" do
    assert {:error, %{reason: "unauthorized"}} =
             connect(EngineWeb.RunnerSocket, %{"ticket" => ""})
  end

  test "com ticket que não existe, a conexão é recusada" do
    assert {:error, %{reason: "unauthorized"}} =
             connect(EngineWeb.RunnerSocket, %{"ticket" => "nunca-existiu"})
  end

  test "com ticket válido, conecta e guarda project_id/user_id/kind no assign" do
    project_id = Ecto.UUID.generate()
    user_id = Ecto.UUID.generate()
    {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, user_id, "runner")

    assert {:ok, socket} = connect(EngineWeb.RunnerSocket, %{"ticket" => bruto})

    assert socket.assigns.project_id == project_id
    assert socket.assigns.user_id == user_id
    assert socket.assigns.kind == "runner"
    assert socket.assigns.ticket == bruto
  end

  test "com ticket já consumido, a conexão é recusada — reuso" do
    project_id = Ecto.UUID.generate()
    {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, Ecto.UUID.generate(), "terminal")

    assert {:ok, _linha} = SocketTicket.consumir(bruto, project_id)

    assert {:error, %{reason: "unauthorized"}} =
             connect(EngineWeb.RunnerSocket, %{"ticket" => bruto})
  end
end
