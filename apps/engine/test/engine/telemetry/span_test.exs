defmodule Engine.Telemetry.SpanTest do
  @moduledoc """
  A camada de span do engine (Fase 5, item 3; texto corrigido no ADR 0035).

  O que se testa aqui é a propriedade que realmente importa: **instrumentar não
  pode mudar o comportamento nem o valor de retorno de nada**. Uma span que
  engole o retorno de uma função, ou que converte exceção em `nil`, seria um
  defeito muito pior que a ausência de trace.

  ## Correção: o SDK está vivo na suite

  Este texto afirmava que sem coletor configurado a API do OTel virava no-op.
  Era falso — `:opentelemetry` é dependência normal e sobe com a aplicação, e o
  que faltava era config, não SDK. Span manual sempre teve `trace_id` real aqui,
  e `otel_test.exs`, ao lado, afirma exatamente isso. O que a suite não tem é
  EXPORTAÇÃO (`config :opentelemetry, traces_exporter: :none`) e instrumentação
  automática (`otel_auto_instrumentation: false`).

  A distinção importa para quem escreve teste novo aqui: dá para afirmar sobre
  `current_trace_id/0`, não dá para afirmar sobre span exportada.
  """

  use ExUnit.Case, async: true

  alias Engine.Telemetry.Span

  describe "with_span/3" do
    test "devolve o valor da função, sem envolvê-lo" do
      assert Span.with_span("teste", %{}, fn -> {:ok, 42} end) == {:ok, 42}
    end

    test "deixa a exceção propagar — instrumentar não engole erro" do
      assert_raise RuntimeError, "explodiu", fn ->
        Span.with_span("teste", %{}, fn -> raise "explodiu" end)
      end
    end

    test "aceita atributo de qualquer tipo sem levantar" do
      # Um struct ou mapa vazado numa chamada não pode derrubar a operação
      # instrumentada: o OTel só aceita primitivos, e a conversão acontece
      # antes de chegar nele.
      assert Span.with_span(
               "teste",
               %{"a" => 1, "b" => :atomo, "c" => %{aninhado: true}, "d" => true},
               fn -> :ok end
             ) == :ok
    end
  end

  describe "with_session/4" do
    test "traceparent nulo não impede a execução" do
      # Sessão criada antes da Fase 5, ou trace não amostrada: o trabalho tem
      # que acontecer igual, só sem vínculo com a trace da sessão.
      assert Span.with_session(nil, "teste", %{}, fn -> :feito end) == :feito
    end

    test "traceparent vazio também é tolerado" do
      assert Span.with_session("", "teste", %{}, fn -> :feito end) == :feito
    end

    test "traceparent válido devolve o valor da função" do
      tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
      assert Span.with_session(tp, "teste", %{}, fn -> :feito end) == :feito
    end
  end

  describe "capture/0 e attach/1" do
    test "atravessam fronteira de processo sem levantar" do
      ctx = Span.capture()

      task =
        Task.async(fn ->
          Span.attach(ctx)
          :dentro_da_task
        end)

      assert Task.await(task) == :dentro_da_task
    end

    test "attach de contexto vazio é no-op" do
      assert Span.attach(%{}) == :ok
    end
  end

  describe "current_trace_id/0" do
    test "devolve nil quando não há span ativa" do
      assert Span.current_trace_id() == nil
      assert Span.current_span_id() == nil
    end
  end
end
