defmodule Engine.Workers.ModelSyncSchedulerWorker do
  @moduledoc """
  Tick periódico do sync de catálogo de modelos (Fase 9c): a cada
  `@interval_seconds` chama `POST /internal/models/sync` na api e se
  reagenda.

  Mesmo idioma do `AnamneseSchedulerWorker` (e pelos mesmos motivos):
  **sem `:unique` no `use`** — declarado no módulo, o job em execução
  colidiria consigo mesmo (mesmo worker, mesmos args, estado
  `:executing`) e o sucessor seria descartado, matando a corrente depois
  de uma rodada. O `unique:` fica só no `kickoff/0`, com
  `states: [:available, :scheduled, :retryable]` (sem `:executing`).

  Diferente da Anamnese, não há job filho por projeto: o catálogo é GLOBAL
  e a api reconcilia todos os providers numa chamada.

  ## Por que uma falha do sync não derruba o job

  A api já responde 200 com o motivo do pulo e a ORIGEM da falha de cada
  provider — um 401 numa credencial não é motivo para o tick inteiro
  reprocessar. Só um erro de TRANSPORTE (a api fora do ar) volta `:error` e
  entra no retry do Oban; o reagendamento acontece antes disso, para a
  corrente não morrer junto com uma rodada ruim.
  """

  use Oban.Worker, queue: :default, max_attempts: 3

  require Logger

  # 6h por default: catálogo de provider muda em escala de dias, e cada rodada
  # gasta uma chamada de API por provider. Configurável por ambiente, como os
  # outros tetos do engine.
  defp interval_seconds,
    do: Application.get_env(:engine, :model_sync_interval_seconds, 21_600)

  @impl true
  def perform(_job) do
    # Reagenda ANTES de trabalhar: se o sync falhar e o job for para retry, a
    # corrente periódica já está garantida e não depende do desfecho.
    %{}
    |> new(schedule_in: interval_seconds())
    |> Oban.insert()

    case api_client().sync_model_catalog() do
      {:ok, relatorio} ->
        registrar(relatorio)
        :ok

      {:error, reason} ->
        # Origem `infra`: nem se chegou a falar com a api (ADR 0020 — o
        # desfecho registra a origem, nunca "falhou" sem mais).
        Logger.warning(
          "sync de catálogo de modelos não alcançou a api (origem: infra): #{inspect(reason)}"
        )

        {:error, reason}
    end
  end

  @doc "Chamado uma vez no boot (ver Engine.Application)."
  def kickoff do
    %{}
    |> new(unique: [period: interval_seconds() * 2, states: [:available, :scheduled, :retryable]])
    |> Oban.insert()
  end

  defp registrar(%{"porProvider" => resultados}) when is_list(resultados) do
    for %{"provider" => provider} = r <- resultados, r["pulado"] do
      Logger.info(
        "sync de catálogo pulou #{provider}: #{r["pulado"]}" <>
          if(r["origemDaFalha"], do: " (origem: #{r["origemDaFalha"]})", else: "")
      )
    end

    :ok
  end

  defp registrar(_outro), do: :ok

  defp api_client do
    Application.get_env(:engine, :engine_api_client, Engine.Sessions.EngineApiClient.Live)
  end
end
