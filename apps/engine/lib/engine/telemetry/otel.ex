defmodule Engine.Telemetry.Otel do
  @moduledoc """
  Ligação das instrumentações automáticas de OpenTelemetry (Fase 5, item 3).

  Chamado de `Engine.Application.start/2`, ANTES da árvore de supervisão: as
  três bibliotecas anexam handlers de `:telemetry`, e um handler anexado depois
  de o evento acontecer não produz span. Na prática isso significa antes de o
  Repo e o Endpoint subirem.

  Nada aqui roda quando `OTEL_EXPORTER_OTLP_ENDPOINT` não está definido: em
  desenvolvimento e em teste não há coletor, e um exportador tentando entregar
  para lugar nenhum enche o log com falha de conexão a cada batch — além de
  criar span em toda query da suite, deixando os testes mais lentos sem que
  ninguém olhe o resultado.

  ## O que fica de fora, e por quê

  Spans de tool call, de turno de LLM e de gate são MANUAIS
  (`Engine.Telemetry.Span`). Nenhuma instrumentação automática saberia que
  `dispatch/2` do ToolLoop é a operação interessante, nem que o `session_id`
  precisa ser atributo. Automático cobre o que é genérico — HTTP, query, job.
  """

  require Logger

  @doc "Anexa as instrumentações automáticas. Idempotente."
  def setup do
    if enabled?() do
      OpentelemetryBandit.setup()
      OpentelemetryPhoenix.setup(adapter: :bandit)

      # Prefixo do :telemetry do Ecto, não o nome do módulo do Repo.
      OpentelemetryEcto.setup([:engine, :repo], db_statement: :disabled)

      OpentelemetryOban.setup()

      Logger.info("otel: instrumentação automática anexada")
      :ok
    else
      :ok
    end
  end

  @doc "Verdadeiro quando há coletor configurado."
  def enabled? do
    case System.get_env("OTEL_EXPORTER_OTLP_ENDPOINT") do
      nil -> false
      "" -> false
      _ -> true
    end
  end
end
