defmodule Engine.Psychologist.Tools do
  @moduledoc """
  Registro de ferramentas do Psicólogo (Fase 4b) — SÓ `emit_hypotheses`.

  Sem `terminal`/`write_file`/`read_file`/`search_workspace`: a análise
  é puramente sobre o event log + regras de negócio + hipóteses
  anteriores, tudo já injetado no contexto do prompt. Restrição
  estrutural, no mesmo espírito do InfraAgent não ter `Terminal`.
  """

  alias Engine.Psychologist.Tools.EmitHypotheses

  @registry [EmitHypotheses]

  def registry, do: @registry
end
