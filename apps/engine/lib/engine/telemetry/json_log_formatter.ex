defmodule Engine.Telemetry.JsonLogFormatter do
  @moduledoc """
  Formatter de log JSON com `trace_id` (Fase 5, item 6).

  ## Por que escrito à mão em vez de uma biblioteca

  As opções do ecossistema (`logger_json` e afins) trazem formatadores para
  Google Cloud, Datadog e Elastic, um esquema de configuração próprio, e nenhuma
  delas injeta o contexto do OpenTelemetry sem código de cola de todo jeito. O
  que precisamos é uma função de 30 linhas que produza um objeto por linha com
  os campos que o nosso Loki e os nossos dashboards esperam — e o CLAUDE.md pede
  justificativa para dependência nova.

  ## O nome do campo é contrato

  `trace_id` (com underscore) é o que o `derivedFields` do datasource do Loki
  procura para transformar a linha em link clicável para o Tempo, e é o que o
  `stage.json` do Alloy extrai como metadado estruturado. Renomear aqui quebra a
  correlação sem quebrar teste nenhum — o mesmo cuidado vale no lado da api.
  """

  @doc """
  Assinatura de `:logger` formatter (`format/2` de `:logger_formatter`).

  Nunca levanta: uma exceção aqui aconteceria DENTRO do logger, e o resultado
  seria perder a linha e, pior, entrar em recursão tentando logar a falha. O
  fallback é uma linha JSON mínima.
  """
  def format(event, config) do
    [encode(event, config), "\n"]
  rescue
    e -> [~s({"level":"error","message":"falha ao formatar log: #{inspect(e)}"}), "\n"]
  end

  defp encode(%{level: level, msg: msg, meta: meta}, _config) do
    base = %{
      "time" => timestamp(meta),
      "level" => to_string(level),
      "message" => message(msg),
      "service" => "brabo-engine"
    }

    base
    |> maybe_put("trace_id", trace_id(meta))
    |> maybe_put("span_id", span_id(meta))
    |> maybe_put("request_id", meta[:request_id])
    |> maybe_put("session_id", meta[:session_id])
    |> maybe_put("mfa", mfa(meta))
    |> Jason.encode!()
  end

  # O `trace_id` da metadata vem do handler do OpenTelemetry quando há um; sem
  # ele, lemos o contexto ativo direto — que é o caso do log emitido de dentro
  # de um GenServer que não passou por requisição HTTP.
  defp trace_id(meta) do
    case meta[:otel_trace_id] do
      nil -> Engine.Telemetry.Span.current_trace_id()
      id -> to_string(id)
    end
  end

  defp span_id(meta) do
    case meta[:otel_span_id] do
      nil -> Engine.Telemetry.Span.current_span_id()
      id -> to_string(id)
    end
  end

  defp message({:string, msg}), do: IO.iodata_to_binary(msg)
  defp message({:report, report}) when is_map(report), do: inspect(report)
  defp message({format, args}) when is_list(args), do: :io_lib.format(format, args) |> to_string()
  defp message(other), do: inspect(other)

  defp timestamp(%{time: time}) when is_integer(time) do
    time
    |> DateTime.from_unix!(:microsecond)
    |> DateTime.to_iso8601()
  end

  defp timestamp(_), do: DateTime.utc_now() |> DateTime.to_iso8601()

  defp mfa(%{mfa: {m, f, a}}), do: "#{inspect(m)}.#{f}/#{a}"
  defp mfa(_), do: nil

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
end
