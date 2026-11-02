defmodule Engine.Workers.RetomadaDeTarefaWorker do
  @moduledoc """
  RN-864 (AT-525): a retomada automática de uma task bloqueada por falha
  PASSAGEIRA de rede/provedor (`Engine.Agents.FalhaDeTurno.passageira?/1`).

  Até `teto/0` (3) retomadas por task, depois de 1, 3 e 10 min — decisão do
  dono. A retomada é o MESMO desbloqueio do humano
  (`UnblockTaskUseCase` na api, pela rota interna `.../tasks/:taskId/unblock`,
  ator `system`): a task volta pegável e o wake `task.became_claimable` sai
  na mesma transação, sem régua nova. Se uma pessoa já desbloqueou, a api não
  faz nada.

  O CONTADOR de retomadas mora no estado do dev agent
  (`retomadas_automaticas`), só em memória: reiniciar o engine o zera, e a
  task pode ganhar mais três — declarado na RN.
  """

  use Oban.Worker, queue: :default, max_attempts: 3

  alias Engine.Sessions.EngineApiClient

  require Logger

  @atrasos_em_minutos [1, 3, 10]

  @doc "Quantas retomadas automáticas uma task pode ter."
  def teto, do: length(@atrasos_em_minutos)

  @doc """
  Agenda a retomada `feitas + 1`. Devolve `{:ok, minutos}` ou `:esgotado`
  quando a task já teve as `teto/0` retomadas.
  """
  def agendar(state, task_id, feitas) when feitas < length(@atrasos_em_minutos) do
    minutos = Enum.at(@atrasos_em_minutos, feitas)

    %{
      "projectId" => state.project_id,
      "sessionId" => state.session_id,
      "taskId" => task_id,
      "agentId" => state.agent_id,
      "tentativa" => feitas + 1
    }
    |> new(schedule_in: minutos * 60)
    |> Oban.insert()

    {:ok, minutos}
  end

  def agendar(_state, _task_id, _feitas), do: :esgotado

  @impl true
  def perform(%Oban.Job{
        args: %{
          "projectId" => project_id,
          "sessionId" => session_id,
          "taskId" => task_id,
          "agentId" => agent_id
        }
      }) do
    case EngineApiClient.unblock_task(project_id, session_id, task_id, agent_id) do
      {:ok, _} ->
        :ok

      {:error, motivo} ->
        Logger.warning("retomada automática da task #{task_id} falhou: #{inspect(motivo)}")
        {:error, motivo}
    end
  end

  def perform(%Oban.Job{}), do: :ok
end
