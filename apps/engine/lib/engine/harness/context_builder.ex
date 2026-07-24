defmodule Engine.Harness.ContextBuilder do
  @moduledoc """
  Coleta as fontes de cada camada e monta a lista ORDENADA de camadas que o
  `Engine.Harness.PromptAssembler` consome. Mantém o assembler puro/agnóstico:
  toda a leitura de banco/fs vive aqui.

  Ordem fixa das 5 camadas (do enunciado): identidade → instruction_files →
  contexto_projeto → regras_negocio → estado_tarefa.

  As camadas `:regras_negocio` e `:estado_tarefa` saem VAZIAS por padrão — só o
  DevAgent (Fase 4a) tem fonte hoje (regras/estado da task, via
  `opts[:business_rules_units]`/`opts[:task_state_units]`, unidades já no
  formato `%{id, content}` consumido pelo assembler). O algoritmo de corte já
  trata lista vazia (0 tokens); os testes exercitam o corte com unidades
  sintéticas.
  """

  alias Engine.Harness.Agents
  alias Engine.Harness.InstructionFiles
  alias Engine.Harness.ProjectContext

  @doc """
  Lista ordenada de camadas pra (projeto, agente). `opts[:workspace_root]`
  sobrescreve a raiz do AGENTS.md lido (default o workspace compartilhado do
  projeto — ver `InstructionFiles.load/3`); `opts[:business_rules_units]`/
  `opts[:task_state_units]` alimentam as camadas hoje vazias por padrão.
  """
  def build_layers(project_id, agent, opts \\ []) do
    [
      identity_layer(agent),
      instruction_files_layer(project_id, agent, opts[:workspace_root]),
      project_context_layer(project_id),
      business_rules_layer(Keyword.get(opts, :business_rules_units, [])),
      task_state_layer(Keyword.get(opts, :task_state_units, []))
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

  defp instruction_files_layer(project_id, agent, workspace_root) do
    %{sources: sources} = InstructionFiles.load(project_id, agent, root: workspace_root)

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

  defp business_rules_layer(units) do
    %{id: :regras_negocio, kind: :units, cut: :drop_whole_units, units: units}
  end

  defp task_state_layer(units) do
    %{id: :estado_tarefa, kind: :units, cut: :drop_whole_units, units: units}
  end

  defp unit_id(%{origin: :db}), do: :db
  defp unit_id(%{origin: :root}), do: :root
  defp unit_id(%{origin: :directory, path: path}), do: {:directory, path}
end
