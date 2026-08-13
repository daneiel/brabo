defmodule Engine.Workers.GateRescueSchedulerWorker do
  @moduledoc """
  Tick periódico do resgate de gates (ADR 0067): a cada `@interval_seconds`
  chama `Engine.Gates.GateRescuer.run/0` e se reagenda.

  Mesmo idioma do `ModelSyncSchedulerWorker`/`AnamneseSchedulerWorker` (e
  pelos mesmos motivos): **sem `:unique` no `use`** — declarado no módulo, o
  job em execução colidiria consigo mesmo (mesmo worker, mesmos args, estado
  `:executing`) e o sucessor seria descartado, matando a corrente depois de
  uma rodada. O `unique:` fica só no `kickoff/0`, com
  `states: [:available, :scheduled, :retryable]` (sem `:executing`).

  Intervalo bem menor que o de Anamnese/model sync (5 min, não 15 min/6h): um
  gate preso trava a PR inteira do usuário, e o custo de cada tick é uma
  query no `gate_states` (quase sempre vazia) — não uma chamada de LLM nem de
  provider externo.
  """

  use Oban.Worker, queue: :default, max_attempts: 3

  # 5 min por default: bem menor que o limiar de staleness (15 min,
  # `gate_rescue_stale_after_seconds`) — o tick só encontra trabalho quando o
  # limiar já passou, então o intervalo curto só custa uma query quase sempre
  # vazia, não resgate prematuro.
  defp interval_seconds,
    do: Application.get_env(:engine, :gate_rescue_interval_seconds, 300)

  @impl true
  def perform(_job) do
    # Reagenda ANTES de trabalhar: mesmo raciocínio do ModelSyncSchedulerWorker
    # — se o resgate falhar (ex.: banco fora do ar) e o job for para retry, a
    # corrente periódica já está garantida e não depende do desfecho.
    %{}
    |> new(schedule_in: interval_seconds())
    |> Oban.insert()

    Engine.Gates.GateRescuer.run()
  end

  @doc "Chamado uma vez no boot (ver Engine.Application)."
  def kickoff do
    %{}
    |> new(unique: [period: interval_seconds() * 2, states: [:available, :scheduled, :retryable]])
    |> Oban.insert()
  end
end
