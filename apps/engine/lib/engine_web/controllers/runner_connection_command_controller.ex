defmodule EngineWeb.RunnerConnectionCommandController do
  @moduledoc """
  A api pedindo ao engine para DERRUBAR a conexão viva de um runner
  (ADR 0147 ponto 6, RN-520) — chamado por
  `POST /internal/projects/:projectId/runner/disconnect` quando uma chave de
  dispositivo é revogada.

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

  alias Engine.Runners.Revogacao

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
end
