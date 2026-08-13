defmodule Engine.Sessions.SocketTicketTest do
  @moduledoc """
  RN-108: `validar/1` (peek, chamado por `connect/3`) e `consumir/2` (UPDATE
  condicional de uso único, chamado por `SessionChannel.join/3`).

  `session_socket_tickets` é fixture de `test_helper.exs` (gerenciada pela
  api via Drizzle) — sem FK, então os uuids de sessão/projeto/usuário aqui não
  precisam existir em `public.sessions`/`public.projects`/`public.users`.
  """

  use Engine.DataCase, async: true

  alias Engine.Sessions.SocketTicket

  defp insert_ticket!(ticket_bruto, attrs \\ %{}) do
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

  describe "validar/1" do
    test "ticket vivo devolve project_id/user_id/scope" do
      ticket = "ticket-bruto-1"
      linha = insert_ticket!(ticket, %{scope: "terminal"})

      assert {:ok, %{project_id: project_id, user_id: user_id, scope: "terminal"}} =
               SocketTicket.validar(ticket)

      assert project_id == linha.project_id
      assert user_id == linha.user_id
    end

    test "ticket inexistente é inválido" do
      assert {:error, :invalid} = SocketTicket.validar("nunca-existiu")
    end

    test "ticket expirado é inválido" do
      ticket = "ticket-expirado"
      insert_ticket!(ticket, %{expires_at: DateTime.add(DateTime.utc_now(), -1, :second)})

      assert {:error, :invalid} = SocketTicket.validar(ticket)
    end

    test "ticket já consumido é inválido" do
      ticket = "ticket-consumido"
      insert_ticket!(ticket, %{consumed_at: DateTime.utc_now()})

      assert {:error, :invalid} = SocketTicket.validar(ticket)
    end
  end

  describe "consumir/2 — uso único" do
    test "consome quando o session_id bate, e marca consumed_at" do
      ticket = "ticket-bruto-2"
      linha = insert_ticket!(ticket)

      assert {:ok, %{project_id: project_id}} =
               SocketTicket.consumir(ticket, linha.session_id)

      assert project_id == linha.project_id

      reloaded = Engine.Repo.get!(SocketTicket, linha.id)
      assert reloaded.consumed_at != nil
    end

    test "REUSO: o segundo consumo do MESMO ticket falha" do
      ticket = "ticket-reuso"
      linha = insert_ticket!(ticket)

      assert {:ok, _} = SocketTicket.consumir(ticket, linha.session_id)
      assert {:error, :invalid} = SocketTicket.consumir(ticket, linha.session_id)
    end

    test "ticket de OUTRA sessão falha — session_id tem que bater" do
      ticket = "ticket-sessao-errada"
      linha = insert_ticket!(ticket)
      outra_sessao = Ecto.UUID.generate()

      assert {:error, :invalid} = SocketTicket.consumir(ticket, outra_sessao)

      # E continua vivo — a tentativa errada não queima o ticket certo.
      assert {:ok, _} = SocketTicket.consumir(ticket, linha.session_id)
    end

    test "ticket expirado falha mesmo com session_id certo" do
      ticket = "ticket-expirado-consumo"

      linha =
        insert_ticket!(ticket, %{expires_at: DateTime.add(DateTime.utc_now(), -1, :second)})

      assert {:error, :invalid} = SocketTicket.consumir(ticket, linha.session_id)
    end

    test "corrida: N consumos concorrentes do MESMO ticket produzem UM sucesso só" do
      ticket = "ticket-corrida"
      linha = insert_ticket!(ticket)

      # Cada task pega sua própria conexão do sandbox (modo :manual, `allow`).
      parent = self()

      resultados =
        1..10
        |> Enum.map(fn _ ->
          Task.async(fn ->
            Ecto.Adapters.SQL.Sandbox.allow(Engine.Repo, parent, self())
            SocketTicket.consumir(ticket, linha.session_id)
          end)
        end)
        |> Enum.map(&Task.await/1)

      sucessos = Enum.count(resultados, &match?({:ok, _}, &1))

      assert sucessos == 1,
             "esperava exatamente 1 sucesso, teve #{sucessos}: #{inspect(resultados)}"
    end
  end
end
