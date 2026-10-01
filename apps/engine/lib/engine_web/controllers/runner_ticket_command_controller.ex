defmodule EngineWeb.RunnerTicketCommandController do
  @moduledoc """
  Emissão de ticket opaco de uso único pro socket `/runner`
  (`EngineWeb.RunnerSocket`/`EngineWeb.TerminalChannel`) — chamado pela api
  via `POST /internal/projects/:projectId/runner-tickets`
  (`Engine.Runners.SocketTicket`, tabela OWNED pelo engine).

  Espelha o INVERSO do fluxo de ticket de sessão (RN-108): lá a api insere
  direto em `session_socket_tickets` (dela, Drizzle) e nunca chama o
  engine; aqui é o engine quem gera e guarda o ticket, e a api PEDE por HTTP
  interno — ver o moduledoc de `Engine.Runners.SocketTicket` para o porquê.

  Desde o ADR 0201 (RN-685) o pedido pode trazer `credentialKind`
  (`"device_key"` | `"pat"`) e `credentialId`: a credencial que o
  `PatAuthGuard` da api autenticou, gravada na linha do ticket para a
  revogação poder mirar só as conexões dela.
  """

  use EngineWeb, :controller

  alias Engine.Runners.SocketTicket

  def create(conn, %{"projectId" => project_id, "userId" => user_id, "kind" => kind} = params)
      when kind in ["runner", "terminal"] do
    # ADR 0201 (RN-685): QUAL credencial pediu o ticket. Ausente (ticket de
    # `terminal`, ou api anterior durante o rollout) ou fora de forma vira
    # `nil` — nunca recusa: o ticket continua servindo, só sem o alvo fino.
    credencial = SocketTicket.credencial(params["credentialKind"], params["credentialId"])

    case SocketTicket.emitir(project_id, user_id, kind, credencial) do
      {:ok, %{ticket: ticket, expires_at: expires_at}} ->
        json(conn, %{ticket: ticket, expiresAt: DateTime.to_iso8601(expires_at)})

      {:error, motivo} ->
        conn
        |> put_status(422)
        |> json(%{error: "falha ao emitir ticket: #{inspect(motivo)}"})
    end
  end

  def create(conn, _params) do
    conn
    |> put_status(400)
    |> json(%{error: ~s(campo "kind" precisa ser "runner" ou "terminal")})
  end
end
