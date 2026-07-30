defmodule Engine.Telemetry.LogFields do
  @moduledoc """
  Os campos de uma linha de log do engine, num mapa (ADR 0035).

  Extraído do `JsonLogFormatter` quando o formatter legível de desenvolvimento
  entrou: os dois precisam exatamente dos mesmos campos, e duas cópias de
  "quais campos uma linha tem" divergem na primeira vez que alguém acrescenta um.
  Aqui se decide O QUE a linha carrega; cada formatter decide COMO renderiza.

  ## O nome do campo é contrato

  `trace_id` (com underscore) é o que o `derivedFields` do datasource do Loki
  procura para transformar a linha em link clicável para o Tempo, e é o que o
  `stage.json` do Alloy extrai como metadado estruturado. O mesmo vale no lado da
  api. Renomear aqui compila, passa na suite, e destrói a correlação.

  ## Precisa ser total

  Isto roda DENTRO do logger. Uma exceção aqui perde a linha e pode recursar
  tentando logar a própria falha, então toda cláusula tem catch-all e nada
  levanta — nem com `msg` de forma inesperada, nem sem `meta`, nem com struct no
  lugar de mapa. `log_fields_test.exs` alimenta lixo de propósito.
  """

  @doc """
  Monta o mapa de campos a partir de um evento de `:logger`.

  Campos ausentes são OMITIDOS em vez de virarem `null`: uma linha com
  `"session_id": null` polui o Loki e não diz nada que a ausência já não diga.
  """
  def build(event) do
    level = Map.get(event, :level, :info)
    msg = Map.get(event, :msg)
    meta = Map.get(event, :meta) || %{}

    %{
      "time" => timestamp(meta),
      "level" => to_string(level),
      "message" => message(msg),
      "service" => "brabo-engine"
    }
    |> maybe_put("trace_id", trace_id(meta))
    |> maybe_put("span_id", span_id(meta))
    |> maybe_put("request_id", meta[:request_id])
    |> maybe_put("session_id", meta[:session_id])
    # `layer` e `path` são o equivalente do caminho entre camadas da api. Hoje
    # nenhum ponto do engine os popula; existem para que `Logger.metadata(layer:)`
    # já apareça no dia em que alguém instrumentar um contexto.
    |> maybe_put("layer", meta[:layer])
    |> maybe_put("path", meta[:path])
    |> maybe_put("mfa", mfa(meta))
  end

  # O `trace_id` da metadata vem do handler do OpenTelemetry quando há um; sem
  # ele, lemos o contexto ativo direto — que é o caso do log emitido de dentro
  # de um GenServer que não passou por requisição HTTP.
  defp trace_id(meta) do
    case meta[:otel_trace_id] do
      nil -> seguro(&Engine.Telemetry.Span.current_trace_id/0)
      id -> to_string(id)
    end
  end

  defp span_id(meta) do
    case meta[:otel_span_id] do
      nil -> seguro(&Engine.Telemetry.Span.current_span_id/0)
      id -> to_string(id)
    end
  end

  # Ler o contexto do OTel não pode derrubar o log.
  defp seguro(fun) do
    fun.()
  rescue
    _ -> nil
  catch
    _, _ -> nil
  end

  defp message({:string, msg}), do: IO.iodata_to_binary(msg)
  defp message({:report, report}) when is_map(report), do: inspect(report)

  defp message({format, args}) when is_list(args) do
    :io_lib.format(format, args) |> to_string()
  rescue
    # `format` e `args` incompatíveis levantariam aqui — e o conteúdo da mensagem
    # não vale perder a linha inteira.
    _ -> inspect({format, args})
  end

  defp message(other), do: inspect(other)

  defp timestamp(%{time: time}) when is_integer(time) do
    time
    |> DateTime.from_unix!(:microsecond)
    |> DateTime.to_iso8601()
  rescue
    _ -> agora()
  end

  defp timestamp(_), do: agora()

  defp agora, do: DateTime.utc_now() |> DateTime.to_iso8601()

  defp mfa(%{mfa: {m, f, a}}), do: "#{inspect(m)}.#{f}/#{a}"
  defp mfa(_), do: nil

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
end
