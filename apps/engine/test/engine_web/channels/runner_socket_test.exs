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

  describe "a credencial no socket (ADR 0201, RN-685)" do
    test "ticket com credencial: ela vai para o assign, e o id do socket a carrega" do
      project_id = Ecto.UUID.generate()
      user_id = Ecto.UUID.generate()
      chave = Ecto.UUID.generate()
      credencial = SocketTicket.credencial("device_key", chave)
      {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, user_id, "runner", credencial)

      assert {:ok, socket} = connect(EngineWeb.RunnerSocket, %{"ticket" => bruto})

      assert socket.assigns.credencial == %{kind: "device_key", id: chave}

      assert EngineWeb.RunnerSocket.id(socket) ==
               "runner_socket:runner:#{project_id}:#{user_id}:device_key:#{chave}"
    end

    test "duas credenciais do MESMO usuário no MESMO projeto têm ids DIFERENTES — o disconnect de uma não alcança a outra" do
      a = EngineWeb.RunnerSocket.socket_id("runner", "p", "u", %{kind: "device_key", id: "k1"})
      b = EngineWeb.RunnerSocket.socket_id("runner", "p", "u", %{kind: "pat", id: "t1"})

      refute a == b
    end

    test "sem credencial (terminal, legado do rollout) o id é o de antes" do
      project_id = Ecto.UUID.generate()
      user_id = Ecto.UUID.generate()
      {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, user_id, "terminal")

      assert {:ok, socket} = connect(EngineWeb.RunnerSocket, %{"ticket" => bruto})

      assert socket.assigns.credencial == nil

      assert EngineWeb.RunnerSocket.id(socket) ==
               "runner_socket:terminal:#{project_id}:#{user_id}"
    end
  end
end
