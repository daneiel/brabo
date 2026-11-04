defmodule Engine.Agents.CatalogoDeFerramentas do
  @moduledoc """
  AT-686 (RN-995): o catálogo COMPLETO de ferramentas e a identidade de cada
  agente, só leitura, para a api expor no card do agente.

  Fonte única: o `tool_specs/0` de cada servidor conversacional e os registros
  de execução e de gate — nenhuma cópia mantida aqui. Devolve só nome e
  descrição (sem `parameters`, sem o prompt composto) e corta a descrição em
  1 000 caracteres (ADR 0060). O catálogo não é o menu de cada passo: o Jev
  (ADR 0179) recorta por passo. Psicólogo e Anamnese ficam fora (atores de
  sistema).
  """

  alias Engine.Harness.Agents

  @teto_da_descricao 1_000

  @conversacionais [
    {"criativo", Engine.Agents.CriativoServer},
    {"po", Engine.Agents.PoServer},
    {"arquiteto", Engine.Agents.ArquitetoServer},
    {"dev-lead", Engine.Agents.DevLeadServer},
    {"ux-designer", Engine.Agents.UxDesignerServer},
    {"staff", Engine.Agents.StaffServer},
    {"infra-lead", Engine.Infra.InfraLeadServer}
  ]

  @registros [
    {"dev-*", &Engine.Dev.Tools.registry/0},
    {"qa-automacao", &Engine.Gates.QaTools.registry/0},
    {"qa-estrategia", &Engine.Gates.QaEstrategiaAgent.tools/0},
    {"qa-performance-seguranca", &Engine.Gates.QaPerformanceSegurancaAgent.tools/0},
    {"appsec", &Engine.Gates.AppSecAgent.tools/0},
    {"infra-workflows", &Engine.Infra.WorkflowsAgent.tools/0}
  ]

  @doc "Lista `%{agente, identidade, ferramentas: [%{nome, descricao}]}`."
  def listar do
    conv = for {slug, mod} <- @conversacionais, do: entrada(slug, mod.tool_specs())

    reg =
      for {slug, registro} <- @registros,
          do: entrada(slug, Engine.Harness.Tools.specs(registro.()))

    conv ++ reg
  end

  defp entrada(slug, specs) do
    %{
      agente: slug,
      identidade: Agents.identity(slug),
      ferramentas:
        Enum.map(specs, fn s ->
          %{nome: s.name, descricao: String.slice(s.description || "", 0, @teto_da_descricao)}
        end)
    }
  end
end
