defmodule Engine.Telemetry.Span do
  @moduledoc """
  Spans manuais do domínio do engine (Fase 5, item 3).

  ## Duas coisas que esta camada resolve, e que a API do OTel não resolve sozinha

  **1. Continuar a trace de uma sessão que começou há horas.**
  `with_session/4` recebe o `traceparent` persistido em `sessions.trace_parent`
  e o usa como parent REMOTO. É isso que faz um tool call de agora aparecer na
  mesma árvore do `session.create` de ontem.

  **2. Atravessar fronteira de processo.**
  O contexto do OTel vive no dicionário do processo. O engine dispara trabalho
  por `GenServer.cast`, `Task.start` e `Task.Supervisor.start_child` — em todos,
  o filho nasce com dicionário vazio e a trace se parte exatamente nos pontos
  mais interessantes (gates, report de término). `capture/0` e `attach/1` levam
  o contexto na mão: capture no pai, attach na primeira linha do filho.

  ## Isto funciona SEM coletor, e sempre funcionou (ADR 0035)

  O texto que ficava aqui afirmava que tudo virava no-op sem coletor, porque sem
  `Engine.Telemetry.Otel.enabled?()` não haveria SDK. Era falso: o `:opentelemetry`
  é dependência normal e sobe com a aplicação: `enabled?/0` só decidia se as
  instrumentações AUTOMÁTICAS eram anexadas, nunca se o SDK existia. Span manual
  sempre teve `trace_id` de verdade, inclusive em `mix test`.

  O que mudou no ADR 0035 é que isso passou a ser intencional em vez de acidente:
  `config :opentelemetry, traces_exporter: :none` em dev e test descarta a span no
  fim (sem ETS, sem batch condenado), e o contexto segue valendo para correlacionar
  log. Ou seja: criar span é barato, e o `trace_id` no log de desenvolvimento é
  real.
  """

  require OpenTelemetry.Tracer, as: Tracer

  @tracer_id :brabo_engine

  @doc """
  Executa `fun` dentro de uma span de nome `name`.

  `attrs` vira atributo da span. A span é fechada mesmo em caso de exceção, e a
  exceção é registrada nela antes de propagar — uma span que não fecha não é
  exportada, e o caminho de erro é o que mais interessa ver no Tempo.
  """
  def with_span(name, attrs \\ %{}, fun) do
    Tracer.with_span name, %{attributes: normalize(attrs)} do
      try do
        fun.()
      rescue
        e ->
          Tracer.record_exception(e, __STACKTRACE__)
          Tracer.set_status(OpenTelemetry.status(:error, Exception.message(e)))
          reraise e, __STACKTRACE__
      end
    end
  end

  @doc """
  Executa `fun` numa span filha da TRACE DA SESSÃO.

  `traceparent` é o valor de `sessions.trace_parent`. Nulo (sessão criada antes
  da Fase 5, ou trace não amostrada) cai no comportamento normal: span raiz
  própria, sem quebrar nada.
  """
  def with_session(traceparent, name, attrs \\ %{}, fun) do
    ctx = context_from_traceparent(traceparent)
    token = OpenTelemetry.Ctx.attach(ctx)

    try do
      with_span(name, attrs, fun)
    after
      OpenTelemetry.Ctx.detach(token)
    end
  end

  @doc """
  Captura o contexto atual para levar a outro processo.

  Use com `attach/1`. Sem este par, todo `cast`/`Task` do engine produz uma
  trace órfã.
  """
  def capture, do: OpenTelemetry.Ctx.get_current()

  @doc "Reanexa um contexto capturado por `capture/0`. Primeira linha do filho."
  def attach(ctx) when ctx == %{}, do: :ok
  def attach(ctx), do: OpenTelemetry.Ctx.attach(ctx)

  @doc "Acrescenta atributos à span ativa."
  def set_attributes(attrs), do: Tracer.set_attributes(normalize(attrs))

  @doc "trace_id ativo em hex, para o log estruturado (item 6)."
  def current_trace_id do
    case Tracer.current_span_ctx() do
      :undefined ->
        nil

      span_ctx ->
        span_ctx
        |> OpenTelemetry.Span.trace_id()
        |> Integer.to_string(16)
        |> String.downcase()
        |> String.pad_leading(32, "0")
    end
  end

  @doc "span_id ativo em hex, para o log estruturado (item 6)."
  def current_span_id do
    case Tracer.current_span_ctx() do
      :undefined ->
        nil

      span_ctx ->
        span_ctx
        |> OpenTelemetry.Span.span_id()
        |> Integer.to_string(16)
        |> String.downcase()
        |> String.pad_leading(16, "0")
    end
  end

  @doc "`traceparent` W3C do contexto ativo, para injetar em header ou evento."
  def current_traceparent do
    :otel_propagator_text_map.inject([])
    |> Enum.find_value(fn
      {"traceparent", value} -> value
      _ -> nil
    end)
  end

  @doc "Contexto a partir de um `traceparent` W3C, para usar como parent remoto."
  def context_from_traceparent(nil), do: OpenTelemetry.Ctx.get_current()
  def context_from_traceparent(""), do: OpenTelemetry.Ctx.get_current()

  def context_from_traceparent(traceparent) when is_binary(traceparent) do
    :otel_propagator_text_map.extract([{"traceparent", traceparent}])
    OpenTelemetry.Ctx.get_current()
  end

  # Atributos do OTel aceitam só tipos primitivos. Converter aqui evita que um
  # struct ou mapa vazado numa chamada derrube a criação da span.
  defp normalize(attrs) when is_map(attrs) do
    Map.new(attrs, fn {k, v} -> {k, primitive(v)} end)
  end

  defp primitive(v) when is_binary(v) or is_number(v) or is_boolean(v), do: v
  defp primitive(v) when is_atom(v), do: to_string(v)
  defp primitive(v), do: inspect(v)

  @doc false
  def tracer_id, do: @tracer_id
end
