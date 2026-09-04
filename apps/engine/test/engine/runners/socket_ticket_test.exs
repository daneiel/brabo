defmodule Engine.Runners.SocketTicketTest do
  @moduledoc """
  Réplica do RN-108 para o ticket de runner/terminal (escopado por PROJETO,
  não por sessão): `emitir/3` (gera e persiste), `validar/1` (peek, chamado
  por `EngineWeb.RunnerSocket.connect/3`) e `consumir/2` (UPDATE condicional
  de uso único, chamado por `EngineWeb.TerminalChannel.join/3`).

  Diferente de `Engine.Sessions.SocketTicketTest`: `runner_socket_tickets` é
  OWNED pelo engine (migração Ecto própria, schema "engine"), não fixture de
  `test_helper.exs` — ver o moduledoc de `Engine.Runners.SocketTicket`.
  """

  use Engine.DataCase, async: true

  alias Engine.Runners.SocketTicket

  describe "emitir/3" do
    test "gera um ticket bruto novo e devolve expires_at ~30s no futuro" do
      project_id = Ecto.UUID.generate()
      user_id = Ecto.UUID.generate()

      assert {:ok, %{ticket: bruto, expires_at: expira}} =
               SocketTicket.emitir(project_id, user_id, "runner")

      assert is_binary(bruto)
      assert byte_size(bruto) > 0
      assert DateTime.diff(expira, DateTime.utc_now(), :second) in 25..30
    end

    test "kind fora do vocabulário fechado não casa nenhuma cláusula" do
      assert_raise FunctionClauseError, fn ->
        SocketTicket.emitir(Ecto.UUID.generate(), Ecto.UUID.generate(), "outro")
      end
    end
  end

  describe "validar/1" do
    test "ticket recém-emitido devolve project_id/user_id/kind" do
      project_id = Ecto.UUID.generate()
      user_id = Ecto.UUID.generate()
      {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, user_id, "terminal")

      assert {:ok, %{project_id: ^project_id, user_id: ^user_id, kind: "terminal"}} =
               SocketTicket.validar(bruto)
    end

    test "ticket inexistente é inválido" do
      assert {:error, :invalid} = SocketTicket.validar("nunca-existiu")
    end

    test "ticket já consumido é inválido" do
      project_id = Ecto.UUID.generate()
      {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, Ecto.UUID.generate(), "runner")

      assert {:ok, _} = SocketTicket.consumir(bruto, project_id)
      assert {:error, :invalid} = SocketTicket.validar(bruto)
    end
  end

  describe "consumir/2 — uso único, escopado por projeto" do
    test "consome quando o project_id bate, e marca consumed_at" do
      project_id = Ecto.UUID.generate()
      {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, Ecto.UUID.generate(), "runner")

      assert {:ok, %{project_id: ^project_id, kind: "runner"}} =
               SocketTicket.consumir(bruto, project_id)
    end

    test "REUSO: o segundo consumo do MESMO ticket falha" do
      project_id = Ecto.UUID.generate()
      {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, Ecto.UUID.generate(), "runner")

      assert {:ok, _} = SocketTicket.consumir(bruto, project_id)
      assert {:error, :invalid} = SocketTicket.consumir(bruto, project_id)
    end

    test "ticket de OUTRO projeto falha — project_id tem que bater" do
      project_id = Ecto.UUID.generate()
      outro_projeto = Ecto.UUID.generate()
      {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, Ecto.UUID.generate(), "runner")

      assert {:error, :invalid} = SocketTicket.consumir(bruto, outro_projeto)

      # E continua vivo — a tentativa errada não queima o ticket certo.
      assert {:ok, _} = SocketTicket.consumir(bruto, project_id)
    end

    test "corrida: N consumos concorrentes do MESMO ticket produzem UM sucesso só" do
      project_id = Ecto.UUID.generate()
      {:ok, %{ticket: bruto}} = SocketTicket.emitir(project_id, Ecto.UUID.generate(), "runner")

      parent = self()

      resultados =
        1..10
        |> Enum.map(fn _ ->
          Task.async(fn ->
            Ecto.Adapters.SQL.Sandbox.allow(Engine.Repo, parent, self())
            SocketTicket.consumir(bruto, project_id)
          end)
        end)
        |> Enum.map(&Task.await/1)

      sucessos = Enum.count(resultados, &match?({:ok, _}, &1))

      assert sucessos == 1,
             "esperava exatamente 1 sucesso, teve #{sucessos}: #{inspect(resultados)}"
    end
  end
end
