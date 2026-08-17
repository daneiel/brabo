defmodule Engine.Gates.AppSecContextBuilder do
  @moduledoc """
  Contexto leve pro "segundo momento" do appsec (RN-360, `docs/fluxo.yml`
  `id: appsec`, ADR 0090): antes de existir código/PR, o threat model roda
  sobre a STORY + o `module_map` vigente do projeto — sem `task_id`, sem
  worktree/`dev_state` (mesmo padrão "segundo momento sem Terminal, sem
  task_id" que a frente `qa-estrategia` está construindo em paralelo pro
  gate `implementavel` do QA, no mesmo ADR conceitual).

  Módulo PRÓPRIO e pequeno, de propósito: na hora em que este código foi
  escrito não havia em `dev` nenhum builder equivalente (busca por
  `qa_estrategia_context`/correlato, vazia) — se a convergência achar algo
  melhor depois de as duas frentes mergearem, este é descartável sem dó.

  Zero mudança na api: reusa duas leituras que já existem —
  `EngineApiClient.list_backlog/1` (a árvore épico→história→tarefa, a mesma
  que o PO lê pela RN-164) pra achar a story, e
  `EngineApiClient.get_infra_context/2` (module_map vigente + ADRs — a
  MESMA leitura sem task/story que a área de Infra já faz) pro module_map.
  """

  alias Engine.Sessions.EngineApiClient

  @doc """
  Busca `story_id` no backlog do projeto e o module_map vigente da sessão
  que criou a story (`story["sessionId"]`, sempre presente — toda story tem
  sessão de origem). Devolve `{:ok, %{story:, module_map:}}` ou
  `{:error, reason}` — `:story_nao_encontrada`, `:story_sem_sessao`, ou o
  que a api devolver.
  """
  def fetch(project_id, story_id) do
    with {:ok, story} <- find_story(project_id, story_id),
         {:session_id, session_id} when is_binary(session_id) <-
           {:session_id, Map.get(story, "sessionId")},
         {:ok, module_map} <- fetch_module_map(project_id, session_id) do
      {:ok, %{story: story, module_map: module_map}}
    else
      {:session_id, _} -> {:error, :story_sem_sessao}
      {:error, reason} -> {:error, reason}
    end
  end

  defp find_story(project_id, story_id) do
    case EngineApiClient.list_backlog(project_id) do
      {:ok, epics} ->
        epics
        |> Enum.find_value(fn epic ->
          Enum.find(Map.get(epic, "stories", []), &(Map.get(&1, "id") == story_id))
        end)
        |> case do
          nil -> {:error, :story_nao_encontrada}
          story -> {:ok, story}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp fetch_module_map(project_id, session_id) do
    case EngineApiClient.get_infra_context(project_id, session_id) do
      {:ok, ctx} -> {:ok, Map.get(ctx, "moduleMap")}
      {:error, reason} -> {:error, reason}
    end
  end
end
