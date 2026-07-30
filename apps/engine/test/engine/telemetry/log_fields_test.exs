defmodule Engine.Telemetry.LogFieldsTest do
  @moduledoc """
  Os campos de uma linha de log do engine (ADR 0035).

  Duas coisas se protegem aqui, e nenhuma é "a formatação está bonita".

  **O contrato de nomes.** `trace_id` com underscore é o que o `stage.json` do
  Alloy extrai e o que o `derivedFields` do Loki procura para ligar a linha ao
  Tempo. Renomear para `traceId` compila, passa em tudo, e destrói a correlação
  clicável — o mesmo cuidado do lado da api.

  **Ser total.** Isto roda DENTRO do logger: uma exceção perde a linha e pode
  recursar tentando logar a própria falha. Então metade dos testes abaixo
  alimenta lixo de propósito — `msg` de forma inesperada, evento sem `meta`,
  `format`/`args` incompatíveis, `time` que não é inteiro.
  """

  use ExUnit.Case, async: true

  alias Engine.Telemetry.LogFields

  defp evento(over \\ %{}) do
    Map.merge(
      %{
        level: :info,
        msg: {:string, "mensagem de teste"},
        meta: %{time: 1_785_374_400_000_000}
      },
      over
    )
  end

  describe "o contrato de nomes" do
    test "usa trace_id e span_id com underscore" do
      campos =
        LogFields.build(
          evento(%{
            meta: %{
              time: 1_785_374_400_000_000,
              otel_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
              otel_span_id: "00f067aa0ba902b7"
            }
          })
        )

      assert campos["trace_id"] == "4bf92f3577b34da6a3ce929d0e0e4736"
      assert campos["span_id"] == "00f067aa0ba902b7"
      refute Map.has_key?(campos, "traceId")
      refute Map.has_key?(campos, "traceID")
    end

    test "sempre marca o serviço" do
      assert LogFields.build(evento())["service"] == "brabo-engine"
    end

    test "level e message são strings" do
      campos = LogFields.build(evento(%{level: :warning}))
      assert campos["level"] == "warning"
      assert campos["message"] == "mensagem de teste"
    end

    test "time é ISO-8601" do
      campos = LogFields.build(evento())
      assert {:ok, _, _} = DateTime.from_iso8601(campos["time"])
    end
  end

  describe "campos ausentes são omitidos, não nulos" do
    test "sem session_id, request_id, layer nem path" do
      campos = LogFields.build(evento())

      # `"session_id": null` polui o Loki e não diz nada que a ausência já não
      # diga.
      refute Map.has_key?(campos, "session_id")
      refute Map.has_key?(campos, "request_id")
      refute Map.has_key?(campos, "layer")
      refute Map.has_key?(campos, "path")
    end

    test "com session_id vindo de Logger.metadata" do
      # O caminho que os workers do outbox passaram a usar. Até o ADR 0035 este
      # campo era permanentemente ausente, porque `Logger.metadata/1` não era
      # chamado em lugar nenhum do engine.
      campos =
        LogFields.build(evento(%{meta: %{time: 1_785_374_400_000_000, session_id: "01JEVHYP"}}))

      assert campos["session_id"] == "01JEVHYP"
    end

    test "mfa vira Módulo.função/aridade" do
      campos =
        LogFields.build(
          evento(%{
            meta: %{time: 1_785_374_400_000_000, mfa: {Engine.Outbox.Drain, :run_once, 0}}
          })
        )

      assert campos["mfa"] == "Engine.Outbox.Drain.run_once/0"
    end
  end

  describe "não levanta com entrada inesperada" do
    test "msg em report" do
      campos = LogFields.build(evento(%{msg: {:report, %{erro: :timeout}}}))
      assert campos["message"] =~ "timeout"
    end

    test "msg em format/args" do
      campos = LogFields.build(evento(%{msg: {~c"valor: ~p", [42]}}))
      assert campos["message"] =~ "42"
    end

    test "msg com format e args incompatíveis" do
      # `~p` esperando um argumento e recebendo nenhum levantaria no io_lib.
      assert %{"message" => mensagem} =
               LogFields.build(evento(%{msg: {~c"valor: ~p ~p", [1]}}))

      assert is_binary(mensagem)
    end

    test "msg de forma completamente inesperada" do
      assert %{"message" => mensagem} = LogFields.build(evento(%{msg: :atom_solto}))
      assert is_binary(mensagem)
    end

    test "evento sem meta" do
      assert %{"time" => tempo} = LogFields.build(%{level: :info, msg: {:string, "x"}})
      assert is_binary(tempo)
    end

    test "evento vazio" do
      # O extremo: nada. Ainda assim tem que sair um mapa com os campos base.
      campos = LogFields.build(%{})
      assert campos["level"] == "info"
      assert campos["service"] == "brabo-engine"
      assert is_binary(campos["time"])
    end

    test "time que não é inteiro cai para agora" do
      campos = LogFields.build(evento(%{meta: %{time: "não é inteiro"}}))
      assert {:ok, _, _} = DateTime.from_iso8601(campos["time"])
    end

    test "o mapa inteiro é serializável em JSON" do
      # É o que o JsonLogFormatter faz em seguida. Um valor não serializável aqui
      # viraria exceção lá.
      campos = LogFields.build(evento(%{msg: {:report, %{pid: self()}}}))
      assert {:ok, _} = Jason.encode(campos)
    end
  end
end
