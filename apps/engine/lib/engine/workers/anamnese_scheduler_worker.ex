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

  # 15 min por default: a Anamnese analisa tendência de comportamento, não
  # precisa de latência baixa — e cada rodada custa LLM. Configurável por
  # ambiente (ANAMNESE_INTERVAL_SECONDS), como os outros tetos da Anamnese.
  defp interval_seconds,
    do: Application.get_env(:engine, :anamnese_interval_seconds, 900)

  @doc """
  Flag de PRODUTO (não confundir com `start_anamnese?`, que é a chave de
  teste que decide se o `kickoff/0` é chamado no boot — ver
  `Engine.Application`): decide se uma rodada NOVA da Anamnese pode
  acontecer, periódica ou sob demanda. Desativado não apaga nada — hipóteses,
  perfis de proficiência e patches de instrução já gravados continuam
  intactos e visíveis.

  Default DESLIGADO a partir de agora: decisão do usuário em 2026-08-10
  ("hoje ele não está trazendo dados de muito valor"), documentada em
  docs/explanation/backlog.md — não é bug, é pausa reversível. Ligar de
  volta é `ANAMNESE_ENABLED=true` e reiniciar o engine.
  """
  def enabled?, do: Application.get_env(:engine, :anamnese_enabled?, false)

  @doc """
  Confere `enabled?/0` a cada tick, não só no boot (RN-115): sem essa
  checagem aqui, uma corrente já agendada ANTES de alguém desativar a flag
  (ou de antes de a flag existir) se reagenda pra sempre, rodando Anamnese
  de verdade com a flag dizendo `false` — foi exatamente o que aconteceu em
  dev (achado real, não hipótese), remediado manualmente cancelando os jobs
  agendados. Desativado, nem `enqueue_projects/0` nem o reagendamento
  acontecem: a corrente morre ali, e um job antigo que ainda dispara uma vez
  se AUTO-CURA sozinho, sem intervenção manual.
  """
  @impl true
  def perform(_job) do
    if enabled?() do
      enqueue_projects()

      %{}
      |> new(schedule_in: interval_seconds())
      |> Oban.insert()
    end

    :ok
  end

  @doc """
  Chamado uma vez no boot (ver Engine.Application).

  Desativado (`enabled?/0` falso), NÃO agenda o job periódico — em vez de
  agendar e deixar `perform/1` no-opar a cada tick. Mais barato (a fila do
  Oban não recebe um job a cada `interval_seconds` só para não fazer nada) e
  mais claro para quem inspeciona a fila: Anamnese desativada não deixa
  rastro nenhum de tentativa. `perform/1` agora confere a MESMA flag (ver
  moduledoc acima) — as duas pontas (nascer e reagendar) respeitam
  `enabled?/0`, e nenhuma delas precisa da outra pra ficar correta.
  """
  def kickoff do
    if enabled?() do
      %{}
      |> new(
        unique: [period: interval_seconds() * 2, states: [:available, :scheduled, :retryable]]
      )
      |> Oban.insert()
    else
      {:ok, :anamnese_desativada}
    end
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
              period: interval_seconds(),
              keys: [:project_id],
              states: [:available, :scheduled, :retryable]
            ]
          )
          |> Oban.insert()
      end
    end
  end
end
