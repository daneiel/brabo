defmodule Engine.Workers.AnamneseSchedulerWorker do
  @moduledoc """
  Tick periódico da Anamnese (Fase 4b): a cada `@interval_seconds`,
  enfileira uma rodada por PROJETO (`AnamneseWorker`) e se reagenda.

  Mesmo idioma do `OutboxDrainWorker` (e pelos mesmos motivos):
  **sem `:unique` no `use`** — declarado no módulo, o job em execução
  colidiria consigo mesmo (mesmo worker, mesmos args, estado
  `:executing`) e o sucessor seria descartado, matando a corrente depois
  de uma rodada. O `unique:` fica só no `kickoff/0`, com
  `states: [:available, :scheduled, :retryable]` (sem `:executing`).

  Os jobs FILHOS têm `unique` por `project_id`, aí sim: se a rodada
  anterior de um projeto ainda não rodou, o tick seguinte não empilha
  outra.
  """

  use Oban.Worker, queue: :default, max_attempts: 3

  # 15 min: a Anamnese analisa tendência de comportamento, não precisa
  # de latência baixa — e cada rodada custa LLM.
  @interval_seconds 900

  @impl true
  def perform(_job) do
    enqueue_projects()

    %{}
    |> new(schedule_in: @interval_seconds)
    |> Oban.insert()

    :ok
  end

  @doc "Chamado uma vez no boot (ver Engine.Application)."
  def kickoff do
    %{}
    |> new(unique: [period: @interval_seconds * 2, states: [:available, :scheduled, :retryable]])
    |> Oban.insert()
  end

  defp enqueue_projects do
    for project_id <- Engine.Projects.Project.list_ids() do
      case Engine.Sessions.ProjectSession.latest_id(project_id) do
        # Projeto sem nenhuma sessão não tem log pra analisar.
        nil ->
          :ok

        session_id ->
          %{project_id: project_id, session_id: session_id}
          |> Engine.Workers.AnamneseWorker.new(
            unique: [
              period: @interval_seconds,
              keys: [:project_id],
              states: [:available, :scheduled, :retryable]
            ]
          )
          |> Oban.insert()
      end
    end
  end
end
