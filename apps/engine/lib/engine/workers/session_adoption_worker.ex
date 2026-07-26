defmodule Engine.Workers.SessionAdoptionWorker do
  @moduledoc """
  Job Oban que adota sessões sem dono periodicamente (Fase 5, item 4). Mesmo
  idioma auto-reagendado do `WorktreeCleanupWorker` e do `OutboxDrainWorker`.

  Ver `Engine.Sessions.Adopter` para o motivo de existir.
  """

  use Oban.Worker, queue: :default, max_attempts: 3

  # 30s: metade do heartbeat default (60s no cluster local, 30s no default do
  # runtime), para que uma sessão órfã seja readotada antes de o timer de
  # heartbeat da adoção começar a correr contra ela.
  @interval_seconds 30

  @impl true
  def perform(_job) do
    Engine.Sessions.Adopter.run()
    %{} |> new(schedule_in: @interval_seconds) |> Oban.insert()
    :ok
  end

  def kickoff do
    %{}
    |> new(unique: [period: 60, states: [:available, :scheduled, :retryable]])
    |> Oban.insert()
  end
end
