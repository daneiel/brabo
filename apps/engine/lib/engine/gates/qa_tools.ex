defmodule Engine.Gates.QaTools do
  @moduledoc """
  Registro de ferramentas do QAAgent (Fase 4a) — lê/roda comando, não edita
  código (sem `write_file`). Passado como `ctx.tools` pro `ToolLoop`.
  """

  alias Engine.Harness.Tools.{ReadFile, SearchWorkspace, Terminal}
  alias Engine.Gates.Tools.EmitQaVerdict

  @registry [ReadFile, SearchWorkspace, Terminal, EmitQaVerdict]

  def registry, do: @registry
end
