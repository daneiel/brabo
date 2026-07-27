defmodule Engine.Harness.InstructionFiles do
  @moduledoc """
  Contrato de leitura+merge das instruções que alimentam a camada
  `:instruction_files` do prompt. Trocável em teste via
  `Application.get_env(:engine, :instruction_files, ...Live)`.

  Fontes e PRECEDÊNCIA documentada (maior primeiro): **banco > diretório >
  raiz**. Ou seja, o arquivo do agente no banco (agent_instructions) vence os
  AGENTS.md do workspace, e entre os AGENTS.md um diretório mais profundo
  (mais específico) vence a raiz.

  Retorno de `load/2`: `%{sources: [...], merged: binary}`, com `sources` em
  ordem CRESCENTE de precedência (raiz → diretório → banco), cada um
  `%{origin, path, content, priority}`. O banco fica por ÚLTIMO — é lido por
  último e vence em conflito ("last wins"); e é essa ordem que o corte usa:
  descarta o menos autoritativo (raiz) primeiro, da cabeça da lista.
  `merged` é a concatenação nessa ordem com um cabeçalho por fonte.
  """

  @callback load(project_id :: String.t(), agent :: String.t(), opts :: keyword()) :: map()
  @callback invalidate(project_id :: String.t(), agent :: String.t(), opts :: keyword()) :: :ok
  @callback invalidate_all(project_id :: String.t(), agent :: String.t()) :: :ok

  @doc """
  `opts[:root]` sobrescreve a raiz onde os AGENTS.md são lidos (default o
  workspace compartilhado do projeto) — usado pelo DevAgent pra ler o AGENTS.md
  do WORKTREE (branch/commit certos), não do clone compartilhado.
  """
  def load(project_id, agent, opts \\ []), do: impl().load(project_id, agent, opts)

  @doc "Mesmo `opts[:root]` de `load/3` — invalida o cache daquela raiz específica."
  def invalidate(project_id, agent, opts \\ []), do: impl().invalidate(project_id, agent, opts)

  @doc """
  Invalida o cache do agente em TODAS as raízes (Fase 4b) — é o que um
  patch de instrução aprovado ou um rollback precisam, já que os dev
  agents cacheiam sob a raiz do próprio worktree.
  """
  def invalidate_all(project_id, agent), do: impl().invalidate_all(project_id, agent)

  defp impl do
    Application.get_env(
      :engine,
      :instruction_files,
      Engine.Harness.InstructionFiles.Live
    )
  end
end

defmodule Engine.Harness.InstructionFiles.Live do
  @moduledoc """
  Implementação real: lê o AGENTS.md da raiz do workspace do projeto
  (`Engine.Actions.Workspace.workspace_dir/1`) e os AGENTS.md dos
  subdiretórios (walk recursivo, pula `.git`), mais o arquivo do agente no
  banco (`Engine.AgentInstructions.Instruction`), e mescla com precedência
  banco > diretório > raiz. Cacheia em ETS; recarrega por invalidação manual.
  """

  @behaviour Engine.Harness.InstructionFiles

  alias Engine.Harness.InstructionFiles.Cache
  alias Engine.AgentInstructions.Instruction
  alias Engine.Actions.Workspace

  # Precedência do banco: acima de qualquer profundidade de diretório.
  @db_priority 1_000_000
  @agents_filename "AGENTS.md"

  @impl true
  def load(project_id, agent, opts \\ []) do
    root = Keyword.get(opts, :root)
    key = {project_id, agent, root}

    case Cache.get(key) do
      {:ok, cached} ->
        cached

      :miss ->
        result = build(project_id, agent, root)
        Cache.put(key, result)
        result
    end
  end

  @impl true
  def invalidate(project_id, agent, opts \\ []) do
    Cache.delete({project_id, agent, Keyword.get(opts, :root)})
  end

  @impl true
  def invalidate_all(project_id, agent) do
    Cache.delete_agent(project_id, agent)
  end

  defp build(project_id, agent, root) do
    # Ordem crescente de precedência: raiz (priority 0) primeiro, banco
    # (priority alta) por último. Desempate estável por path.
    sources =
      (db_source(project_id, agent) ++ file_sources(root || Workspace.workspace_dir(project_id)))
      |> Enum.sort_by(fn s -> {s.priority, source_path(s)} end)

    %{sources: sources, merged: merge(sources)}
  end

  defp db_source(project_id, agent) do
    case Instruction.get(project_id, agent) do
      nil ->
        []

      %{content: content, version: version} ->
        [%{origin: :db, path: nil, content: content, priority: @db_priority, version: version}]
    end
  end

  defp file_sources(root) do
    collect(root, root, 0)
    |> Enum.map(fn {path, depth} ->
      %{
        origin: if(depth == 0, do: :root, else: :directory),
        path: Path.relative_to(path, root),
        content: File.read!(path),
        priority: depth
      }
    end)
  end

  # Walk recursivo coletando {abs_path_do_AGENTS.md, profundidade}. Pula .git.
  defp collect(dir, root, depth) do
    case File.ls(dir) do
      {:ok, entries} ->
        Enum.flat_map(entries, fn entry ->
          path = Path.join(dir, entry)

          cond do
            entry == ".git" -> []
            entry == @agents_filename and File.regular?(path) -> [{path, depth}]
            File.dir?(path) -> collect(path, root, depth + 1)
            true -> []
          end
        end)

      {:error, _} ->
        []
    end
  end

  defp merge(sources) do
    sources
    |> Enum.map(&format_source/1)
    |> Enum.join("\n\n")
  end

  defp format_source(%{origin: :db, version: version, content: content}) do
    "<!-- instrução do agente (banco, v#{version}) -->\n#{content}"
  end

  defp format_source(%{origin: :root, content: content}) do
    "<!-- AGENTS.md (raiz) -->\n#{content}"
  end

  defp format_source(%{origin: :directory, path: path, content: content}) do
    "<!-- AGENTS.md (#{path}) -->\n#{content}"
  end

  # Path estável pra desempate de ordenação (banco não tem path).
  defp source_path(%{path: nil}), do: ""
  defp source_path(%{path: path}), do: path
end
