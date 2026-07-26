defmodule EngineWeb.Telemetry do
  use Supervisor
  import Telemetry.Metrics

  def start_link(arg) do
    Supervisor.start_link(__MODULE__, arg, name: __MODULE__)
  end

  @prometheus_name :engine_prometheus

  @impl true
  def init(_arg) do
    children = [
      # Telemetry poller will execute the given period measurements
      # every 10_000ms. Learn more here: https://telemetry-metrics.hexdocs.pm
      {:telemetry_poller, measurements: periodic_measurements(), period: 10_000},
      {TelemetryMetricsPrometheus.Core,
       metrics: prometheus_metrics(), name: @prometheus_name, require_seconds: false}
      # Add reporters as children of your supervision tree.
      # {Telemetry.Metrics.ConsoleReporter, metrics: metrics()}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  @doc "Nome do agregador Prometheus, usado pelo `EngineWeb.MetricsController`."
  def prometheus_name, do: @prometheus_name

  @doc """
  O subconjunto de métricas realmente exportado em `/metrics` hoje.

  Deliberadamente pequeno: a observabilidade completa (OpenTelemetry, custo por
  projeto, taxa de aprovação de ações, dashboards) é o item 5 da Fase 5, sessão
  própria. Aqui entra o que o item 3 exige — a profundidade de fila que o HPA
  consome — mais dois medidores de VM que custam zero.

  Não é `metrics/0` porque `TelemetryMetricsPrometheus.Core` **não suporta
  `Telemetry.Metrics.Summary`**, e `metrics/0` é quase toda somatórios: passá-la
  inteira faria o reporter logar erro por métrica não suportada a cada boot.
  `metrics/0` fica intacta para o reporter que a sessão do item 5 escolher.
  """
  def prometheus_metrics do
    [
      last_value([:oban, :queue, :depth],
        event_name: Engine.Telemetry.ObanQueueDepth.event(),
        measurement: :depth,
        tags: [:queue, :state],
        description: "Jobs do Oban por fila e estado. O HPA do engine consome state=available."
      ),
      last_value([:vm, :memory, :total],
        unit: {:byte, :kilobyte},
        description: "Memória total da VM Erlang"
      ),
      last_value([:vm, :total_run_queue_lengths, :total],
        description: "Tamanho total das run queues do scheduler"
      )
    ]
  end

  def metrics do
    [
      # Phoenix Metrics
      summary("phoenix.endpoint.start.system_time",
        unit: {:native, :millisecond}
      ),
      summary("phoenix.endpoint.stop.duration",
        unit: {:native, :millisecond}
      ),
      summary("phoenix.router_dispatch.start.system_time",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("phoenix.router_dispatch.exception.duration",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("phoenix.router_dispatch.stop.duration",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("phoenix.socket_connected.duration",
        unit: {:native, :millisecond}
      ),
      sum("phoenix.socket_drain.count"),
      summary("phoenix.channel_joined.duration",
        unit: {:native, :millisecond}
      ),
      summary("phoenix.channel_handled_in.duration",
        tags: [:event],
        unit: {:native, :millisecond}
      ),

      # Database Metrics
      summary("engine.repo.query.total_time",
        unit: {:native, :millisecond},
        description: "The sum of the other measurements"
      ),
      summary("engine.repo.query.decode_time",
        unit: {:native, :millisecond},
        description: "The time spent decoding the data received from the database"
      ),
      summary("engine.repo.query.query_time",
        unit: {:native, :millisecond},
        description: "The time spent executing the query"
      ),
      summary("engine.repo.query.queue_time",
        unit: {:native, :millisecond},
        description: "The time spent waiting for a database connection"
      ),
      summary("engine.repo.query.idle_time",
        unit: {:native, :millisecond},
        description:
          "The time the connection spent waiting before being checked out for the query"
      ),

      # VM Metrics
      summary("vm.memory.total", unit: {:byte, :kilobyte}),
      summary("vm.total_run_queue_lengths.total"),
      summary("vm.total_run_queue_lengths.cpu"),
      summary("vm.total_run_queue_lengths.io")
    ]
  end

  defp periodic_measurements do
    # Desligado em teste: o poller roda fora da Sandbox do Ecto e cada ciclo
    # viraria um aviso de "ownership" a cada 10s durante a suite inteira. Os
    # testes chamam `ObanQueueDepth.measure/0` direto.
    # As medições de VM (`vm.memory`, `vm.total_run_queue_lengths`) vêm do
    # poller default da própria aplicação :telemetry_poller — não se repetem
    # aqui.
    if Application.get_env(:engine, :poll_oban_queue_depth, true) do
      [{Engine.Telemetry.ObanQueueDepth, :measure, []}]
    else
      []
    end
  end
end
