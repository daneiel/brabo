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
    RagFeedback,
    ListarContratosDeModulos
  }

  alias Engine.Dev.Tools.{ReportDone, ReportBlocked}

  # `RagFeedback` anda sempre junto de `RagSearch` (RN-480): buscar sem poder
  # dizer se o resultado serviu deixa a calibração dos pesos sem sinal de
  # verdade nenhum. É `:direct` como a busca — votar não é efeito externo.
  #
  # `ListarContratosDeModulos` (RN-684, ADR 0200): a interface de OUTRO módulo
  # vem do contrato que o Arquiteto declarou, nunca do worktree de outro dev.
  # LEITURA, `:direct`, sem parâmetro — o módulo do dev vem de `ctx.module`.
  @registry [
    ReadFile,
    SearchWorkspace,
    WriteFile,
    Terminal,
    RagSearch,
    RagFeedback,
    ListarContratosDeModulos,
    ReportDone,
    ReportBlocked
  ]

  def registry, do: @registry
end
