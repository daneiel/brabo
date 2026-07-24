defmodule Engine.Dev.ContextBuilder do
  @moduledoc """
  Monta as camadas extras do harness pro DevAgent (Fase 4a): `regras_negocio`
  (as regras de negócio da story) e `estado_tarefa` (RF/RNF/DoD/DoR da story,
  descrição da task, ADRs do projeto) — a partir do contexto rico buscado da
  api (`EngineApiClient.get_dev_context/3`). As demais camadas (identidade,
  instruction_files, contexto_projeto) vêm do `Engine.Harness.ContextBuilder`
  normal, sem mudança — ver `Engine.Harness.ToolLoop.Default.system_prompt/1`.
  """

  alias Engine.Sessions.EngineApiClient

  @doc """
  Busca o contexto da task na api e devolve `{:ok, %{task:, story:,
  business_rules_units:, task_state_units:}}` — os dois últimos já no formato
  `%{id, content}` que `Engine.Harness.ContextBuilder`/`PromptAssembler`
  consomem; `task`/`story` (mapas string-key crus da api) ficam disponíveis
  pro `DevAgentServer` montar a mensagem inicial e o corpo do PR (título/DoD).
  """
  def fetch(project_id, session_id, task_id) do
    case EngineApiClient.get_dev_context(project_id, session_id, task_id) do
      {:ok, ctx} -> {:ok, build(ctx)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp build(%{"task" => task, "story" => story} = ctx) do
    rules = Map.get(ctx, "businessRules", [])
    adrs = Map.get(ctx, "adrs", [])

    %{
      task: task,
      story: story,
      business_rules_units: business_rules_units(rules),
      task_state_units: task_state_units(task, story, adrs)
    }
  end

  defp business_rules_units(rules) do
    Enum.with_index(rules, fn rule, i ->
      %{
        id: {:business_rule, i},
        content: "#{Map.get(rule, "title")}\n#{Map.get(rule, "description")}"
      }
    end)
  end

  defp task_state_units(task, story, adrs) do
    story_unit = %{id: :story, content: story_content(story)}
    task_unit = %{id: :task, content: "Task: #{task["title"]}\n#{task["description"]}"}

    adr_units =
      Enum.with_index(adrs, fn adr, i ->
        %{id: {:adr, i}, content: "ADR: #{adr["title"]}\n#{adr["content"]}"}
      end)

    [story_unit, task_unit | adr_units]
  end

  defp story_content(story) do
    """
    Story: #{story["title"]}
    #{story["description"]}

    Requisitos funcionais:
    #{format_list(story["rf"])}

    Requisitos não funcionais:
    #{format_list(story["rnf"])}

    Definition of Done:
    #{format_list(story["dod"])}

    Definition of Ready:
    #{format_list(story["dor"])}
    """
  end

  defp format_list(nil), do: "(nenhum)"
  defp format_list([]), do: "(nenhum)"
  defp format_list(items), do: Enum.map_join(items, "\n", &"- #{&1}")
end
