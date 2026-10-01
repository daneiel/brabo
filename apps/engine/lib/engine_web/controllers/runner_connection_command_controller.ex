defmodule EngineWeb.RunnerConnectionCommandController do
  @moduledoc """
  A api pedindo ao engine para DERRUBAR a conexão viva de um runner
  (ADR 0147 ponto 6, RN-520). Duas rotas, dois alvos (ADR 0201, RN-685):

  - `POST /internal/runner/disconnect-credential` (`disconnect_credential/2`)
    — a revogação de UMA credencial, chave de dispositivo ou PAT: derruba só
    as conexões abertas com ela, em qualquer projeto;
  - `POST /internal/projects/:projectId/runner/disconnect` (`disconnect/2`) —
    o par `{projeto, usuário}`, que hoje só a remoção de membro de workspace
    usa (RN-615): ela tira a PESSOA, com a credencial que for.

  Existe pela MESMA razão de `EngineWeb.ContainerCommandController`: só o
  engine enxerga o canal Phoenix onde o runner está pendurado. A api manda o
  comando, o engine alcança o pid — nenhum dos dois faz o trabalho do outro.
  Este controller não consulta a tabela de chaves (quem decide o que foi
  revogado é a api), e a api não fala com o canal.

  ## A resposta é SEMPRE 200

  Mesma disciplina de `ContainerCommandController`. Os quatro desfechos —
  `derrubado`, `sem_runner`, `de_outro_dono`, `timeout` — são informação, não
  erro: do outro lado, o `DELETE` da chave é 204 e idempotente, e a revogação
  não pode falhar porque não havia ninguém conectado. O único 400 possível é
  pedido malformado (sem `userId`), que é defeito de quem chamou.
  """

  use EngineWeb, :controller

  alias Engine.Runners.{Revogacao, SocketTicket}

  def disconnect(conn, %{"projectId" => project_id, "userId" => user_id})
      when is_binary(user_id) and user_id != "" do
    case Revogacao.derrubar(project_id, user_id) do
      {:ok, desfecho} -> json(conn, %{desfecho: Atom.to_string(desfecho)})
      {:error, :timeout} -> json(conn, %{desfecho: "timeout"})
    end
  end

  def disconnect(conn, _params) do
    conn
    |> put_status(400)
    |> json(%{error: ~s(campo "userId" é obrigatório)})
  end

  @doc """
  Revogação de UMA credencial (ADR 0201, RN-685): derruba toda conexão de
  runner aberta com ela, em qualquer projeto, e anula os tickets dela que
  ainda não entraram. Corpo: `credentialKind` (`"device_key"` | `"pat"`),
  `credentialId`, e — só para a conexão LEGADA do rollout — `userId` e
  `projectIds` (ver `Engine.Runners.Revogacao`).

  Mesma disciplina do `disconnect/2`: 200 com o BALANÇO, nunca erro por não
  haver o que derrubar. O 400 é só credencial fora de forma, que é defeito de
  quem chamou — e é 400 justamente para a api NÃO tomar "não mirei nada" por
  "não havia nada".
  """
  def disconnect_credential(
        conn,
        %{"credentialKind" => kind, "credentialId" => id} = params
      ) do
    case SocketTicket.credencial(kind, id) do
      nil ->
        credencial_invalida(conn)

      credencial ->
        {:ok, balanco} =
          Revogacao.derrubar_credencial(
            credencial,
            params["userId"],
            List.wrap(params["projectIds"])
          )

        json(conn, %{
          derrubados: balanco.derrubados,
          legados: balanco.legados,
          intocados: balanco.intocados,
          semResposta: balanco.sem_resposta,
          ticketsAnulados: balanco.tickets_anulados
        })
    end
  end

  def disconnect_credential(conn, _params), do: credencial_invalida(conn)

  defp credencial_invalida(conn) do
    conn
    |> put_status(400)
    |> json(%{
      error: ~s[campos "credentialKind" ("device_key" | "pat") e "credentialId" são obrigatórios]
    })
  end
end
