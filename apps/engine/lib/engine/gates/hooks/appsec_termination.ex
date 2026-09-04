defmodule Engine.Gates.Hooks.AppSecTermination do
  @moduledoc """
  Hook `:post_tool_use` PRÓPRIO do appsec (RN-360) — termina o `ToolLoop`
  quando `emit_threat_model` teve sucesso.

  Não reaproveita `Engine.Gates.Hooks.Termination`: aquele hook é dos
  pareceres `approved`/`changes_requested` do QA (`emit_qa_verdict`/
  `emit_perf_seguranca_verdict`), com uma forma FIXA
  (`veredito`/`resumo`/`itens`/`coverage_matrix`). O threat model não tem
  veredito — é sempre um registro, nunca uma aprovação/reprovação — então a
  forma extraída é outra, e um `case` a mais dentro do hook compartilhado
  faria QA e appsec divergirem escondidos na mesma cláusula.
  """

  @behaviour Engine.Harness.Hooks

  @impl true
  def call(%{tool: "emit_threat_model", result_ok?: true, args: args}) do
    {:halt,
     {"emit_threat_model",
      %{
        threat_model: Map.get(args, "threatModel", ""),
        requisitos_de_seguranca: Map.get(args, "requisitosSeguranca", []),
        riscos: Map.get(args, "riscos", [])
      }}}
  end

  def call(ctx), do: {:cont, ctx}
end
