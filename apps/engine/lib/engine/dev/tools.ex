defmodule Engine.Dev.Tools do
  @moduledoc """
  Registro de ferramentas do DevAgent (Fase 4a) — reaproveita as ferramentas
  genéricas do harness (sem `EmitArtifact`, que é do time de produto) e
  adiciona a disciplina de término (`ReportDone`/`ReportBlocked`). Passado
  como `ctx.tools` pro `Engine.Harness.ToolLoop.run/1` — ver
  `Engine.Harness.Tools.specs/1`/`find/2`.
  """

  alias Engine.Harness.Tools.{
    ReadFile,
    SearchWorkspace,
    WriteFile,
    Terminal,
    RagSearch,
    RagFeedback
  }

  alias Engine.Dev.Tools.{ReportDone, ReportBlocked}

  # `RagFeedback` anda sempre junto de `RagSearch` (RN-480): buscar sem poder
  # dizer se o resultado serviu deixa a calibração dos pesos sem sinal de
  # verdade nenhum. É `:direct` como a busca — votar não é efeito externo.
  @registry [
    ReadFile,
    SearchWorkspace,
    WriteFile,
    Terminal,
    RagSearch,
    RagFeedback,
    ReportDone,
    ReportBlocked
  ]

  def registry, do: @registry
end
