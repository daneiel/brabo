defmodule Engine.Workers.OutboxDrainWorker do
  @moduledoc """
  Job Oban recorrente que drena a outbox — se auto-reagenda a cada
  @interval_seconds em vez de depender de Oban.Plugins.Cron (que só
  daria granularidade de minuto, insuficiente aqui).
  """

  use Oban.Worker, queue: :default, max_attempts: 5

  @interval_seconds 2

  @impl true
  def perform(_job) do
    Engine.Outbox.Drain.run_once()
    # Sem :unique aqui — cada execução SEMPRE precisa conseguir inserir
    # seu próprio sucessor. Se :unique (que checaria contra :executing)
    # estivesse declarado no `use Oban.Worker` acima, o job que está
    # RODANDO agora bateria de volta na PRÓPRIA linha (mesmo worker,
    # mesmos args vazios, estado "executing") e o insert do sucessor
    # nunca aconteceria — matando a cadeia após a primeira execução.
    %{} |> new(schedule_in: @interval_seconds) |> Oban.insert()
    :ok
  end

  @doc """
  Chamado só no boot. Aqui SIM vale checar unicidade — evita acumular
  cadeias duplicadas se o container reiniciar enquanto já existe um job
  pendente. Passado no call site (não em `use Oban.Worker`) justamente
  pra não disparar o linter de compilação do Oban sobre :executing
  faltando — aqui a checagem é against :available/:scheduled/:retryable
  apenas, o que é seguro e correto pro caso de boot.
  """
  def kickoff do
    %{}
    |> new(unique: [period: 60, states: [:available, :scheduled, :retryable]])
    |> Oban.insert()
  end
end
