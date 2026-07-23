defmodule Engine.Psychologist.Stub do
  @moduledoc """
  Placeholder — análise por LLM real é fase 3+ (CLAUDE.md: "não
  implementar agentes de produto/execução"). Isto é só o ponto de
  extensão estrutural: roteamento do outbox + um evento de texto fixo.
  Trocar summarize/1 é o único ponto de extensão pra quando a análise
  real for implementada.
  """

  def summarize(events) do
    %{
      summary:
        "Resumo de hipótese ainda não implementado — análise por LLM prevista para fase 3+.",
      event_count: length(events)
    }
  end
end
