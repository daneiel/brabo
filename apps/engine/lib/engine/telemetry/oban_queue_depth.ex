defmodule Engine.Telemetry.ObanQueueDepth do
  @moduledoc """
  Profundidade das filas do Oban como métrica Prometheus (Fase 5, item 3) — é
  o sinal que o HPA do engine usa para escalar.

  ## Por que SQL e não `Oban.check_queue/1`

  `Oban.check_queue/1` devolve o estado do produtor LOCAL: quantos jobs este nó
  está executando agora. Para HPA isso é a métrica errada por definição — a
  pergunta é quanto trabalho existe esperando no cluster inteiro, que é uma
  propriedade da tabela, não do nó. `Oban.Met` responderia, mas é Oban Pro.

  A consulta é uma agregação por `queue`/`state` na `engine.oban_jobs`, a cada
  ciclo do `:telemetry_poller` (10s). Barata: o Oban já cria índice por
  `state`/`queue` para o próprio despacho.

  ## O detalhe que faz a diferença entre escalar e não parar de escalar

  Três workers se auto-reagendam — `OutboxDrainWorker` a cada 2s,
  `WorktreeCleanupWorker` a cada 60s e `AnamneseSchedulerWorker` a cada
  `ANAMNESE_INTERVAL_SECONDS` — inserindo o próprio sucessor. Em regime normal
  **sempre existem jobs em `scheduled`**, e a fila nunca está vazia.

  Por isso a métrica é dimensionada por `state` e o HPA filtra
  `state="available"`: um HPA que contasse a tabela inteira, ou que somasse
  `scheduled`, ficaria permanentemente acima do alvo e escalaria o engine ao
  máximo num sistema ocioso.
  """

  require Logger

  @event [:engine, :oban, :queue]

  # Estados que representam trabalho ainda não concluído. `completed`,
  # `discarded` e `cancelled` ficam de fora: são histórico, e o Pruner os
  # remove depois. `available` é o backlog real (é o que o HPA olha);
  # `executing` é capacidade em uso; `scheduled` e `retryable` são trabalho
  # futuro, medidos para diagnóstico mas não para escalar.
  @states ~w(available scheduled executing retryable)

  @doc """
  Medição do `:telemetry_poller`. Emite um evento por par {queue, state}.

  Nunca levanta: uma falha de banco aqui derrubaria o poller e, com ele, TODAS
  as métricas do nó — inclusive as que diriam que o banco caiu.
  """
  def measure do
    case query() do
      {:ok, rows} ->
        Enum.each(rows, fn {queue, state, count} ->
          :telemetry.execute(@event, %{depth: count}, %{queue: queue, state: state})
        end)

        # Sem esta parte a métrica é "pegajosa": uma fila que esvaziou para de
        # ser reportada e o Prometheus continua servindo o último valor > 0
        # até o scrape expirar. O HPA leria backlog que não existe mais.
        emit_zeros(rows)

      {:error, reason} ->
        Logger.warning("ObanQueueDepth: falha ao medir profundidade: #{inspect(reason)}")
    end

    :ok
  end

  @doc "Nome do evento de telemetria, para quem define a métrica."
  def event, do: @event

  defp query do
    sql = """
    SELECT queue, state::text, count(*)
    FROM engine.oban_jobs
    WHERE state = ANY($1)
    GROUP BY queue, state
    """

    case Ecto.Adapters.SQL.query(Engine.Repo, sql, [@states]) do
      {:ok, %{rows: rows}} ->
        {:ok, Enum.map(rows, fn [queue, state, count] -> {queue, state, count} end)}

      {:error, reason} ->
        {:error, reason}
    end
  rescue
    e -> {:error, e}
  catch
    :exit, reason -> {:error, reason}
  end

  # Zera os pares {queue, state} conhecidos que não vieram na consulta.
  defp emit_zeros(rows) do
    present = MapSet.new(rows, fn {queue, state, _} -> {queue, state} end)
    queues = rows |> Enum.map(fn {queue, _, _} -> queue end) |> Enum.uniq()
    queues = Enum.uniq(queues ++ configured_queues())

    for queue <- queues, state <- @states, not MapSet.member?(present, {queue, state}) do
      :telemetry.execute(@event, %{depth: 0}, %{queue: queue, state: state})
    end
  end

  defp configured_queues do
    :engine
    |> Application.get_env(Oban, [])
    |> Keyword.get(:queues, [])
    |> Enum.map(fn
      {name, _opts} -> to_string(name)
      name -> to_string(name)
    end)
  rescue
    _ -> []
  end
end
