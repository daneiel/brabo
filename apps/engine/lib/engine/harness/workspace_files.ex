defmodule Engine.Harness.WorkspaceFiles do
  @moduledoc """
  Acesso a arquivos DENTRO do workspace do projeto
  (`Engine.Actions.Workspace.workspace_dir/1`), com bloqueio de path
  traversal — nenhum caminho pode escapar do diretório do projeto. É a base
  das ferramentas read_file / search_workspace / write_file do ToolLoop.

  Todo caminho relativo passa por `safe_path/2`, que resolve contra o
  workspace e rejeita qualquer coisa que suba pra fora dele (`../`, path
  absoluto, etc.).
  """

  alias Engine.Actions.Workspace

  @doc """
  Resolve `rel` contra o workspace do projeto. `{:ok, abs}` só se o caminho
  final ficar DENTRO do workspace; `{:error, :traversal}` caso contrário.
  """
  def safe_path(project_id, rel) do
    dir = Workspace.workspace_dir(project_id)
    abs = Path.expand(rel, dir)

    if abs == dir or String.starts_with?(abs, dir <> "/") do
      {:ok, abs}
    else
      {:error, :traversal}
    end
  end

  @doc "Lê um arquivo do workspace. Bloqueia traversal e arquivo inexistente."
  def read_file(project_id, rel) do
    with {:ok, abs} <- safe_path(project_id, rel),
         {:ok, content} <- File.read(abs) do
      {:ok, content}
    end
  end

  @doc """
  Escreve um arquivo no workspace (cria diretórios intermediários). Bloqueia
  traversal. Usado pela ferramenta write_file quando o path está na whitelist.
  """
  def write_file(project_id, rel, content) do
    with {:ok, abs} <- safe_path(project_id, rel),
         :ok <- File.mkdir_p(Path.dirname(abs)),
         :ok <- File.write(abs, content) do
      {:ok, abs}
    end
  end

  @doc """
  Busca `query` (substring, case-insensitive) nos NOMES e no CONTEÚDO dos
  arquivos do workspace. Walk recursivo pulando `.git`. Retorna lista de
  `%{path, matched_name, matched_content}` (paths relativos ao workspace).
  """
  def search(project_id, query) do
    dir = Workspace.workspace_dir(project_id)
    needle = String.downcase(query)

    dir
    |> walk()
    |> Enum.map(fn abs ->
      rel = Path.relative_to(abs, dir)
      content = File.read(abs)

      matched_name = String.contains?(String.downcase(rel), needle)

      matched_content =
        case content do
          {:ok, bin} -> String.valid?(bin) and String.contains?(String.downcase(bin), needle)
          _ -> false
        end

      %{path: rel, matched_name: matched_name, matched_content: matched_content}
    end)
    |> Enum.filter(&(&1.matched_name or &1.matched_content))
  end

  # Walk recursivo de arquivos regulares (pula .git), mesmo padrão do
  # InstructionFiles.Live. Paths ordenados pra determinismo.
  defp walk(dir) do
    case File.ls(dir) do
      {:ok, entries} ->
        entries
        |> Enum.sort()
        |> Enum.flat_map(fn entry ->
          path = Path.join(dir, entry)

          cond do
            entry == ".git" -> []
            File.regular?(path) -> [path]
            File.dir?(path) -> walk(path)
            true -> []
          end
        end)

      {:error, _} ->
        []
    end
  end
end
