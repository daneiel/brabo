defmodule Engine.Telemetry.JsonLogFormatter do
  @moduledoc """
  Formatter de log JSON com `trace_id` (Fase 5, item 6).

  Usado em produção. Em desenvolvimento quem formata é o
  `Engine.Telemetry.PrettyLogFormatter`; os dois leem os MESMOS campos, de
  `Engine.Telemetry.LogFields` — este só os serializa em JSON.

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
  def format(event, _config) do
    [event |> Engine.Telemetry.LogFields.build() |> Jason.encode!(), "\n"]
  rescue
    e -> [~s({"level":"error","message":"falha ao formatar log: #{inspect(e)}"}), "\n"]
  end
end
