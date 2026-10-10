defmodule Engine.Gates.Hooks.TerminationPlanoDeTeste do
  @moduledoc """
  Hook `:post_tool_use` que termina o `ToolLoop` do `Engine.Gates.QaEstrategiaAgent`
  quando `emit_plano_de_teste` teve sucesso — mesmo MECANISMO de
  `Engine.Gates.Hooks.Termination`, mas para uma tool de FORMA diferente
  (`planoDeTeste`/`criteriosExecutaveis`/`estrategiaDeAutomacao`, sem
  `veredito`/`resumo`/`itens`). Hook próprio por família de forma, não um
  comparador genérico que tentaria casar as duas formas na mesma cláusula.
  """

  @behaviour Engine.Harness.Hooks

  @impl true
  def call(%{tool: "emit_plano_de_teste", result_ok?: true, args: args}) do
    {:halt,
     {"emit_plano_de_teste",
      %{
        plano_de_teste: Map.get(args, "planoDeTeste", ""),
        # RN-805 (AT-478): o argumento cru pode chegar como STRING JSON; a
        # tool já validou a lista normalizada (RN-719), então o hook normaliza
        # igual — senão o artefato era recusado (`:criterios_vazios`) depois
        # de a tool dizer "registrado", e a Automação caía no `Enum` da string.
        criterios_executaveis:
          Engine.Gates.Hooks.Termination.lista(Map.get(args, "criteriosExecutaveis")),
        estrategia_de_automacao: Map.get(args, "estrategiaDeAutomacao", "")
      }}}
  end

  def call(ctx), do: {:cont, ctx}
end
