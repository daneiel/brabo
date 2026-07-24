defmodule Engine.Harness.ContextBuilder do
  @moduledoc """
  Coleta as fontes de cada camada e monta a lista ORDENADA de camadas que o
  `Engine.Harness.PromptAssembler` consome. Mantém o assembler puro/agnóstico:
  toda a leitura de banco/fs vive aqui.

  Ordem fixa das 5 camadas (do enunciado): identidade → instruction_files →
  contexto_projeto → regras_negocio → estado_tarefa.

  As camadas `:regras_negocio` e `:estado_tarefa` saem VAZIAS por ora — não há
  fonte ainda (business_rule é emitido pelo Criativo na Fase 3b; o estado da
  tarefa vem do ToolLoop/agentes). O algoritmo de corte já as trata (vazio =
  0 tokens); os testes exercitam o corte com unidades sintéticas.
  """

  alias Engine.Harness.Agents
  alias Engine.Harness.InstructionFiles
  alias Engine.Harness.ProjectContext

  @doc "Lista ordenada de camadas pra (projeto, agente)."
  def build_layers(project_id, agent) do
    [
      identity_layer(agent),
      instruction_files_layer(project_id, agent),
      project_context_layer(project_id),
      business_rules_layer(),
      task_state_layer()
    ]
  end

  defp identity_layer(agent) do
    %{
      id: :identidade,
      kind: :blob,
      cut: :keep_or_drop,
      content: Agents.identity(agent)
    }
  end

  defp instruction_files_layer(project_id, agent) do
    %{sources: sources} = InstructionFiles.load(project_id, agent)

    # `sources` já vem em ordem de descarte (menor precedência na cabeça);
    # cada fonte vira uma unidade cortável inteira.
    units =
      Enum.map(sources, fn s ->
        %{id: unit_id(s), content: s.content}
      end)

    %{id: :instruction_files, kind: :units, cut: :drop_whole_units, units: units}
  end

  defp project_context_layer(project_id) do
    %{
      id: :contexto_projeto,
      kind: :blob,
      cut: :truncate_tail,
      content: ProjectContext.build(project_id)
    }
  end

  # Vazias por ora (sem fonte até a Fase 3b) — presentes na ordenação com o
  # orçamento; o assembler lida com lista vazia sem corte.
  defp business_rules_layer do
    %{id: :regras_negocio, kind: :units, cut: :drop_whole_units, units: []}
  end

  defp task_state_layer do
    %{id: :estado_tarefa, kind: :units, cut: :drop_whole_units, units: []}
  end

  defp unit_id(%{origin: :db}), do: :db
  defp unit_id(%{origin: :root}), do: :root
  defp unit_id(%{origin: :directory, path: path}), do: {:directory, path}
end
