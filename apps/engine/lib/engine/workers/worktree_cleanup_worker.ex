defmodule Engine.Workers.WorktreeCleanupWorker do
  @moduledoc """
  Job Oban que poda worktrees órfãos periodicamente (Fase 4a). Auto-reagendado
  (mesmo idioma do OutboxDrainWorker) — worktrees de agentes mortos são
  removidos sem depender de nenhum sinal de término.
  """

  use Oban.Worker, queue: :default, max_attempts: 3

  @interval_seconds 60

  @impl true
  def perform(_job) do
    Engine.Dev.WorktreeCleanup.run()
    %{} |> new(schedule_in: @interval_seconds) |> Oban.insert()
    :ok
  end

  def kickoff do
    %{}
    |> new(unique: [period: 120, states: [:available, :scheduled, :retryable]])
    |> Oban.insert()
  end
end
