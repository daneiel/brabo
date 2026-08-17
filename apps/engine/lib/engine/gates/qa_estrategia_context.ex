defmodule Engine.Gates.QaEstrategiaContext do
  @moduledoc """
  Contexto LEVE da QA-estratégia (ADR 0090): só STORY + `module_map` vigente
  do projeto — sem `dev_state`/`worktree_path`. O gate `implementavel`
  (`docs/gates.yml`) roda PRE-DEV: não há dev agent, worktree nem `task_id`
  ainda, ao contrário de `Engine.Gates.QaPerformanceSegurancaAgent`, que
  reusa `Engine.Dev.ContextBuilder.fetch/3` (por TASK, código já existe numa
  branch). Este builder é por STORY, antes de tudo isso existir.

  Reusa duas funções do `EngineApiClient` que já existem — nenhuma rota
  nova:

    * `list_backlog/1` — a árvore épico → história → tarefa que o PO já lê
      (RN-164); a story é achada nela pelo id.
    * `get_infra_context/2` — o MESMO `GetInfraContextUseCase` que o Infra
      Lead consome (`moduleMap` + `adrs` + `gitProvider`), aqui só pelo
      campo `moduleMap`. Reusar em vez de abrir uma rota nova só para omitir
      dois campos evitaria duplicar contrato para economizar um
      `Map.get/2` — o `sessionId` que a rota exige na URL não é usado pelo
      caso de uso (`GetInfraContextUseCase.execute/1` só recebe
      `project_id`), então qualquer sessão serve.
  """

  alias Engine.Sessions.EngineApiClient

  @doc """
  Devolve `{:ok, %{story:, module_map:}}` ou `{:error, :story_not_found}` /
  `{:error, reason}` (falha de rede/api). `module_map` pode ser `nil`
  (projeto sem module_map vigente ainda).
  """
  @spec fetch(String.t(), String.t(), String.t()) ::
          {:ok, %{story: map(), module_map: map() | nil}} | {:error, term()}
  def fetch(project_id, session_id, story_id) do
    with {:ok, story} <- find_story(project_id, story_id),
         {:ok, module_map} <- fetch_module_map(project_id, session_id) do
      {:ok, %{story: story, module_map: module_map}}
    end
  end

  defp find_story(project_id, story_id) do
    case EngineApiClient.list_backlog(project_id) do
      {:ok, epics} ->
        epics
        |> Enum.flat_map(&Map.get(&1, "stories", []))
        |> Enum.find(&(Map.get(&1, "id") == story_id))
        |> case do
          nil -> {:error, :story_not_found}
          story -> {:ok, story}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp fetch_module_map(project_id, session_id) do
    case EngineApiClient.get_infra_context(project_id, session_id) do
      {:ok, %{"moduleMap" => module_map}} -> {:ok, module_map}
      {:ok, _sem_module_map} -> {:ok, nil}
      {:error, reason} -> {:error, reason}
    end
  end
end
