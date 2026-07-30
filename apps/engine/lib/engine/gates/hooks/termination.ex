defmodule Engine.Gates.Hooks.Termination do
  @moduledoc """
  Hook `:post_tool_use` que termina o `ToolLoop` de um gate de QA quando a
  tool de parecer da subespecialidade teve sucesso — mesmo mecanismo de
  `Engine.Dev.Hooks.Termination` (halt propagado pelo `ToolLoop.Default`).

  Casa as duas tools de parecer que existem hoje (`emit_qa_verdict`, da
  Automação; `emit_perf_seguranca_verdict`, de Performance/Segurança — Fase
  8b) na MESMA cláusula: as duas devolvem `veredito`/`resumo`/`itens`, e só
  `emit_qa_verdict` tem `coverageMatrix` — que fica `[]` pra quem não manda.
  Um hook só, não um por tool, porque a extração é idêntica; o halt carrega o
  NOME da tool que disparou, e é por ele que cada agente (`QaAutomacaoAgent`/
  `QaPerformanceSegurancaAgent`) reconhece o próprio parecer.
  """

  @behaviour Engine.Harness.Hooks

  @tools_de_parecer ["emit_qa_verdict", "emit_perf_seguranca_verdict"]

  @impl true
  def call(%{tool: tool, result_ok?: true, args: args}) when tool in @tools_de_parecer do
    {:halt,
     {tool,
      %{
        veredito: Map.get(args, "veredito"),
        resumo: Map.get(args, "resumo", ""),
        itens: Map.get(args, "itens", []),
        coverage_matrix: Map.get(args, "coverageMatrix", [])
      }}}
  end

  def call(ctx), do: {:cont, ctx}
end
