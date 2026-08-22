defmodule Engine.Harness.InstructionFiles do
  @moduledoc """
  Contrato de leitura+merge das instruções que alimentam a camada
  `:instruction_files` do prompt. Trocável em teste via
  `Application.get_env(:engine, :instruction_files, ...Live)`.

  Fontes e PRECEDÊNCIA documentada (maior primeiro): **banco > grafo >
  diretório > raiz**. Ou seja, o arquivo do agente no banco
  (agent_instructions) vence o TEMPLATE do grafo de conhecimento (Neo4j,
  Onda 1), que por sua vez vence os AGENTS.md do workspace, e entre os
  AGENTS.md um diretório mais profundo (mais específico) vence a raiz. O
  usuário (banco, via `instruction_patch`) sempre pode sobrescrever
  qualquer coisa — regra de negócio já estabelecida, o grafo NUNCA vence o
  banco.

  Retorno de `load/2`: `%{sources: [...], merged: binary}`, com `sources` em
  ordem CRESCENTE de precedência (raiz → diretório → grafo → banco), cada um
  `%{origin, path, content, priority}`. O banco fica por ÚLTIMO — é lido por
  último e vence em conflito ("last wins"); e é essa ordem que o corte usa:
  descarta o menos autoritativo (raiz) primeiro, da cabeça da lista.
  `merged` é a concatenação nessa ordem com um cabeçalho por fonte.
  """

  @callback load(project_id :: String.t(), agent :: String.t(), opts :: keyword()) :: map()
  @callback invalidate(project_id :: String.t(), agent :: String.t(), opts :: keyword()) :: :ok
  @callback invalidate_all(project_id :: String.t(), agent :: String.t()) :: :ok

  @doc """
  Busca um template de prompt no grafo de conhecimento (Neo4j, via
  `EngineApiClient.get_prompt_template/2`), FORA da precedência de
  `load/3` — usado tanto pela fonte `:graph` do merge quanto por quem
  precisa de um template nomeado isolado (ex.: `Engine.Harness.Agents`
  pra identidade do `ux-designer`). Desligado por
  `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` (default `false`); com a flag
  ligada, degrada pra `:none` em qualquer erro (api fora do ar, template
  não semeado) — NUNCA levanta.
  """
  @callback graph_template(name :: String.t(), version :: String.t() | nil) ::
              {:ok, binary()} | :none

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

  @doc "Ver `@callback graph_template/2`."
  def graph_template(name, version \\ nil), do: impl().graph_template(name, version)

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
  banco (`Engine.AgentInstructions.Instruction`) e o template ativo do
  grafo de conhecimento (`EngineApiClient.get_prompt_template/2`, chave o
  próprio `agent`), e mescla com precedência banco > grafo > diretório >
  raiz. Cacheia em ETS; recarrega por invalidação manual (banco/arquivo) ou
  TTL curto (grafo — ver `graph_template/2`).
  """

  @behaviour Engine.Harness.InstructionFiles

  alias Engine.Harness.InstructionFiles.Cache
  alias Engine.AgentInstructions.Instruction
  alias Engine.Actions.Workspace
  alias Engine.Sessions.EngineApiClient

  # Precedência do banco: acima de qualquer profundidade de diretório e do
  # grafo. Grafo fica ABAIXO do banco e ACIMA de qualquer diretório
  # realista (profundidades de AGENTS.md nunca chegam nem perto disso).
  @db_priority 1_000_000
  @graph_priority 500_000
  @agents_filename "AGENTS.md"

  # TTL do cache de template do grafo — curto de propósito: o conteúdo é
  # editado por fora (seeder/curadoria) e o engine não tem como saber que
  # mudou a não ser reconsultando. 60s é o mesmo espírito do resto do
  # harness (nenhum outro cache do produto usa TTL; este é o primeiro,
  # porque é o primeiro cujo dono NÃO é o próprio processo que grava —
  # banco/arquivo são invalidados por evento explícito, grafo não tem
  # canal de invalidação nenhum ainda).
  @graph_ttl_seconds 60

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

  @impl true
  def graph_template(name, version) do
    if graph_enabled?() do
      fetch_graph_template(name, version)
    else
      :none
    end
  end

  defp build(project_id, agent, root) do
    # Ordem crescente de precedência: raiz (priority 0) primeiro, banco
    # (priority alta) por último. Desempate estável por path.
    sources =
      (db_source(project_id, agent) ++
         graph_source(agent) ++ file_sources(root || Workspace.workspace_dir(project_id)))
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

  # Fonte :graph do merge genérico — template nomeado pelo próprio `agent`
  # (ex.: "arquiteto"), versão ATIVA (nil). Distinto do template nomeado
  # arbitrário que `graph_template/2` também serve pra outros chamadores
  # (ex.: identidade do ux-designer, nome "ux-designer-identity") — aqui a
  # convenção de nome é "um template por agente", lá quem chama escolhe o
  # nome.
  defp graph_source(agent) do
    case graph_template(agent, nil) do
      {:ok, content} ->
        [%{origin: :graph, path: nil, content: content, priority: @graph_priority}]

      :none ->
        []
    end
  end

  defp graph_enabled?,
    do: Application.get_env(:engine, :graph_instruction_templates_enabled?, false)

  defp fetch_graph_template(name, version) do
    key = {:graph_template, name, version}

    case Cache.get(key) do
      {:ok, %{content: content, expires_at: expires_at}} ->
        if System.monotonic_time(:second) < expires_at do
          {:ok, content}
        else
          refresh_graph_template(key, name, version)
        end

      :miss ->
        refresh_graph_template(key, name, version)
    end
  end

  # Sempre busca a versão ATIVA de novo ao expirar o TTL — é isso que
  # garante que o cache local nunca sirva um hash velho por mais do que
  # `@graph_ttl_seconds`: se o hash da versão ativa mudou no grafo, o
  # próximo refresh já traz o conteúdo novo (não há como "invalidar por
  # hash" sem reconsultar, e reconsultar sob demanda derrotaria o cache).
  # Erro (api fora do ar, template inexistente) NUNCA propaga — a fonte
  # simplesmente não contribui, e nada fica cacheado (a próxima chamada
  # tenta de novo, sem negative caching).
  defp refresh_graph_template(key, name, version) do
    case EngineApiClient.get_prompt_template(name, version) do
      {:ok, %{"body" => body}} ->
        Cache.put(key, %{
          content: body,
          expires_at: System.monotonic_time(:second) + @graph_ttl_seconds
        })

        {:ok, body}

      {:error, _reason} ->
        :none
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

  defp format_source(%{origin: :graph, content: content}) do
    "<!-- instrução do agente (grafo de conhecimento) -->\n#{content}"
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
