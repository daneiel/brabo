defmodule Engine.Telemetry.Otel do
  @moduledoc """
  Ligação das instrumentações automáticas de OpenTelemetry (Fase 5, item 3).

  Chamado de `Engine.Application.start/2`, ANTES da árvore de supervisão: as
  três bibliotecas anexam handlers de `:telemetry`, e um handler anexado depois
  de o evento acontecer não produz span. Na prática isso significa antes de o
  Repo e o Endpoint subirem.

  ## Isto NÃO é mais condicionado a haver coletor (ADR 0035)

  Até a Fase 5 o `setup/0` inteiro vivia atrás de
  `OTEL_EXPORTER_OTLP_ENDPOINT`, com a justificativa de que um exportador
  entregando para lugar nenhum enche o log. O gate estava invertido, por dois
  motivos que só aparecem juntos:

  1. **Ele nunca desligou exportador nenhum.** Não havia (e não há) config
     `:opentelemetry` em `config/` — então o SDK subia com o default do
     `otel_configuration`, que é `{opentelemetry_exporter, %{}}` apontando para
     `localhost:4318`. O engine pagava por um batch condenado em
     desenvolvimento **e em `mix test`**, exatamente o que o comentário dizia
     evitar.
  2. **O que ele desligava era a extração.** É o `OpentelemetryBandit` que
     chama `:otel_propagator_text_map.extract/1` nos headers de entrada — a
     peça que faz a span do engine ser filha da span da api e compartilhar o
     `trace_id`. Com o gate ligado em dev, a correlação que o ADR 0026 projetou
     não existia justamente onde mais se precisa dela.

  Agora anexar instrumentação e exportar span são decisões separadas: aqui se
  anexa sempre, e quem decide destino é `config :opentelemetry, traces_exporter`
  (`:none` em dev e test, e em `runtime.exs` quando não há endpoint). Com
  `:none` o `otel_batch_processor` chama `disable/1` na inicialização e passa a
  descartar span sem tocar a ETS — criar span fica barato e não vaza.

  ## O que fica de fora, e por quê

  Spans de tool call, de turno de LLM e de gate são MANUAIS
  (`Engine.Telemetry.Span`). Nenhuma instrumentação automática saberia que
  `dispatch/2` do ToolLoop é a operação interessante, nem que o `session_id`
  precisa ser atributo. Automático cobre o que é genérico — HTTP, query, job.
  """

  require Logger

  @doc "Anexa as instrumentações automáticas. Idempotente."
  def setup do
    if auto_instrumentation?() do
      OpentelemetryBandit.setup()
      OpentelemetryPhoenix.setup(adapter: :bandit)

      # Prefixo do :telemetry do Ecto, não o nome do módulo do Repo.
      OpentelemetryEcto.setup([:engine, :repo], db_statement: :disabled)

      OpentelemetryOban.setup()

      Logger.info("otel: instrumentação automática anexada")
    end

    :ok
  end

  @doc """
  Verdadeiro quando as instrumentações automáticas devem ser anexadas.

  Ligado por default, inclusive sem coletor: é o que dá `trace_id` correlacionado
  em desenvolvimento. Desligado só na suite (`config/test.exs`), onde um span por
  query do Ecto encareceria toda `DataCase` sem ninguém olhar o resultado — a
  suite ainda cria span manual e tem `trace_id` de verdade, porque isso não
  depende daqui.
  """
  def auto_instrumentation? do
    Application.get_env(:engine, :otel_auto_instrumentation, true)
  end
end
