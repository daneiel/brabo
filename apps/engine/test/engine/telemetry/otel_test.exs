defmodule Engine.Telemetry.OtelTest do
  @moduledoc """
  A separação entre instrumentar e exportar (ADR 0035).

  A regressão que este arquivo existe para pegar tem duas metades, e as duas
  vinham do mesmo gate invertido:

  1. `Otel.setup/0` ficava atrás de `OTEL_EXPORTER_OTLP_ENDPOINT`, então em
     desenvolvimento o `OpentelemetryBandit` não era anexado — e é ele que faz
     `:otel_propagator_text_map.extract/1` nos headers de entrada. Sem isso a
     span do engine não é filha da span da api, e o `trace_id` do log dos dois
     serviços nunca coincide. O gate matava exatamente a peça da correlação.
  2. O gate não desligava exportador nenhum: sem config `:opentelemetry`, o SDK
     sobe com o default `{opentelemetry_exporter, %{}}` para `localhost:4318`.
     Quem desliga é `config :opentelemetry, traces_exporter: :none`.

  O que se afirma aqui é a propriedade que o ADR promete: **sem coletor, span
  manual tem `trace_id` de verdade.** É isso que faz o log de dev ser
  correlacionável. Se alguém puser o `setup/0` atrás de um gate de novo, ou tirar
  o `traces_exporter: :none`, é aqui que aparece.
  """

  use ExUnit.Case, async: true

  alias Engine.Telemetry.Otel
  alias Engine.Telemetry.Span

  describe "setup/0" do
    test "devolve :ok e é idempotente" do
      # Chamado de `Engine.Application.start/2`; levantar aqui impediria o boot.
      assert Otel.setup() == :ok
      assert Otel.setup() == :ok
    end
  end

  describe "auto_instrumentation?/0" do
    test "está desligado na suite, e é a única coisa que o flag desliga" do
      # `config/test.exs` desliga o automático para não pagar um span do Ecto por
      # query. O manual continua valendo — é o que os testes abaixo mostram.
      refute Otel.auto_instrumentation?()
    end

    test "o default é ligado quando ninguém configura" do
      # O default importa: é o que faz `pnpm dev` ter correlação sem ninguém
      # precisar exportar variável.
      Application.delete_env(:engine, :otel_auto_instrumentation)
      assert Otel.auto_instrumentation?()
    after
      Application.put_env(:engine, :otel_auto_instrumentation, false)
    end
  end

  describe "sem coletor configurado" do
    test "span manual tem trace_id e span_id de verdade" do
      Span.with_span("teste", %{}, fn ->
        assert Span.current_trace_id() =~ ~r/^[0-9a-f]{32}$/
        assert Span.current_span_id() =~ ~r/^[0-9a-f]{16}$/
      end)
    end

    test "current_traceparent devolve um traceparent W3C dentro da span" do
      # É o valor que o `trace_headers/1` do EngineApiClient injeta e que a api
      # adota como parent. Sem SDK vivo isto seria nil, e a metade
      # engine -> api da correlação não existiria.
      Span.with_span("teste", %{}, fn ->
        assert Span.current_traceparent() =~
                 ~r/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/
      end)
    end

    test "adota o traceparent remoto — o mesmo trace_id da api" do
      # A propriedade a que "o mesmo trace nos três apps" se reduz do lado do
      # engine: `with_session/4` pendura o trabalho na trace que a api começou.
      trace_id_da_api = "4bf92f3577b34da6a3ce929d0e0e4736"
      traceparent = "00-#{trace_id_da_api}-00f067aa0ba902b7-01"

      Span.with_session(traceparent, "agent.turn", %{}, fn ->
        assert Span.current_trace_id() == trace_id_da_api
      end)
    end

    test "fora de span não há trace id, e isso não levanta" do
      # O formatter de log consulta isto a cada linha; levantar aqui derrubaria
      # o log, não só a trace.
      refute Span.current_trace_id()
      refute Span.current_traceparent()
    end
  end
end
