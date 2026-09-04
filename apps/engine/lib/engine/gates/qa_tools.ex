defmodule Engine.Gates.QaTools do
  @moduledoc """
  Registro de ferramentas do QAAgent (Fase 4a) — lê/roda comando, não edita
  código (sem `write_file`). Passado como `ctx.tools` pro `ToolLoop`.
  """

  alias Engine.Harness.Tools.{ReadFile, SearchWorkspace, Terminal, RagSearch, RagFeedback}
  alias Engine.Gates.Tools.EmitQaVerdict

  # RagSearch entrou aqui (frente rag_search): o QA-lead revisando uma PR
  # pode citar convenção/ADR indexado em vez de só o que está no diff — a
  # mesma classe de contexto que ReadFile/SearchWorkspace já servem, só que
  # sobre docs/ADRs indexados em vez do worktree.
  #
  # RagFeedback anda junto (RN-480): buscar sem poder dizer se o trecho serviu
  # deixa a calibração dos pesos sem sinal de verdade. `:direct` como a busca.
  @registry [ReadFile, SearchWorkspace, Terminal, RagSearch, RagFeedback, EmitQaVerdict]

  def registry, do: @registry
end
