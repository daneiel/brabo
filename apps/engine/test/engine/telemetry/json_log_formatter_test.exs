defmodule Engine.Telemetry.JsonLogFormatterTest do
  @moduledoc """
  O formatter de log JSON do engine (Fase 5, item 6).

  O que estes testes protegem é o CONTRATO DE NOMES DE CAMPO, não a formatação.
  `trace_id` (com underscore) é o que o `stage.json` do Alloy extrai como
  metadado estruturado e o que o `derivedFields` do datasource do Loki procura
  para transformar a linha em link clicável para o Tempo. Renomear para
  `traceId` compila, não quebra teste nenhum e destrói a correlação — o sintoma
  é um link que deixou de aparecer no Grafana, que ninguém nota até precisar
  dele.
  """

  use ExUnit.Case, async: true

  alias Engine.Telemetry.JsonLogFormatter

  defp format(event) do
    event
    |> JsonLogFormatter.format(%{})
    |> IO.iodata_to_binary()
  end

  defp decode(event) do
    event |> format() |> String.trim() |> Jason.decode!()
  end

  test "produz UMA linha de JSON válido terminada em newline" do
    out = format(%{level: :info, msg: {:string, "olá"}, meta: %{}})

    assert String.ends_with?(out, "\n")
    assert [_single] = String.split(String.trim(out), "\n")
    assert %{"message" => "olá"} = Jason.decode!(String.trim(out))
  end

  test "emite os campos que o Loki e os dashboards esperam" do
    log = decode(%{level: :warning, msg: {:string, "cuidado"}, meta: %{}})

    assert log["level"] == "warning"
    assert log["message"] == "cuidado"
    assert log["service"] == "brabo-engine"
    assert is_binary(log["time"])
    # ISO-8601: é o que o Loki e um humano leem sem conversão.
    assert {:ok, _, _} = DateTime.from_iso8601(log["time"])
  end

  test "o campo de trace é `trace_id`, com underscore" do
    log =
      decode(%{
        level: :info,
        msg: {:string, "x"},
        meta: %{otel_trace_id: ~c"abc123", otel_span_id: ~c"def456"}
      })

    assert log["trace_id"] == "abc123"
    assert log["span_id"] == "def456"
    refute Map.has_key?(log, "traceId")
  end

  test "omite campos ausentes em vez de emitir null" do
    log = decode(%{level: :info, msg: {:string, "x"}, meta: %{}})

    # Linha sem trace ativo não deve carregar `"trace_id": null`: o
    # `stage.json` do Alloy extrairia a string "null" como metadado, e o link
    # do Grafana apontaria para uma trace inexistente.
    refute Map.has_key?(log, "trace_id")
    refute Map.has_key?(log, "request_id")
  end

  test "carrega request_id e session_id quando estão na metadata" do
    log =
      decode(%{
        level: :info,
        msg: {:string, "x"},
        meta: %{request_id: "req-1", session_id: "sess-1"}
      })

    assert log["request_id"] == "req-1"
    assert log["session_id"] == "sess-1"
  end

  test "formata as três formas de mensagem do :logger" do
    assert decode(%{level: :info, msg: {:string, "texto"}, meta: %{}})["message"] == "texto"

    assert decode(%{level: :info, msg: {~c"n=~p", [42]}, meta: %{}})["message"] =~ "42"

    assert decode(%{level: :info, msg: {:report, %{a: 1}}, meta: %{}})["message"] =~ "a: 1"
  end

  test "nunca levanta: uma exceção aqui aconteceria DENTRO do logger" do
    # Evento deliberadamente malformado. O fallback tem que ser uma linha JSON
    # válida — levantar aqui perderia a linha e poderia entrar em recursão
    # tentando logar a própria falha do logger.
    out = format(%{level: :info})

    assert String.ends_with?(out, "\n")
    assert %{"level" => _} = Jason.decode!(String.trim(out))
  end
end
