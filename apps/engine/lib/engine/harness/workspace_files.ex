defmodule Engine.Harness.WorkspaceFiles do
  @moduledoc """
  Acesso a arquivos DENTRO de uma raiz (o workspace compartilhado do projeto,
  `Engine.Actions.Workspace.workspace_dir/1`, ou — pro DevAgent — o worktree
  do agente), com bloqueio de path traversal — nenhum caminho pode escapar da
  raiz. É a base das ferramentas read_file / search_workspace / write_file do
  ToolLoop.

  Todo caminho relativo passa por `safe_path/2`, que resolve contra a raiz
  dada e rejeita qualquer coisa que suba pra fora dela (`../`, path
  absoluto, etc.).
  """

  @doc """
  Resolve `rel` contra `dir`. `{:ok, abs}` só se o caminho final ficar DENTRO
  de `dir`; `{:error, :traversal}` caso contrário.
  """
  def safe_path(dir, rel) do
    abs = Path.expand(rel, dir)

    if abs == dir or String.starts_with?(abs, dir <> "/") do
      {:ok, abs}
    else
      {:error, :traversal}
    end
  end

  @doc "Lê um arquivo de dentro de `dir`. Bloqueia traversal e arquivo inexistente."
  def read_file(dir, rel) do
    with {:ok, abs} <- safe_path(dir, rel),
         {:ok, content} <- File.read(abs) do
      {:ok, content}
    end
  end

  @doc """
  Escreve um arquivo dentro de `dir` (cria diretórios intermediários).
  Bloqueia traversal. Usado pela ferramenta write_file quando o path está na
  whitelist.
  """
  def write_file(dir, rel, content) do
    with {:ok, abs} <- safe_path(dir, rel),
         :ok <- File.mkdir_p(Path.dirname(abs)),
         :ok <- File.write(abs, content) do
      {:ok, abs}
    end
  end

  @doc """
  Quantos arquivos buscáveis o workspace tem (mesmo walk da `search/2`).

  Existe para a `search_workspace` poder dizer a diferença entre "procurei e
  não achei" e "não há nada para procurar". Sem isso as duas situações
  produziam a MESMA frase, e um agente num repositório recém-provisionado lia
  "nenhum resultado" como "refine a busca" — repetindo a busca até queimar o
  teto de iterações sem nunca escrever uma linha (achado X da FASE 13b).
  """
  def count(dir), do: dir |> walk() |> length()

  @doc """
  Busca `query` (substring, case-insensitive) nos NOMES e no CONTEÚDO dos
  arquivos dentro de `dir`. Walk recursivo pulando `.git`. Retorna lista de
  `%{path, matched_name, matched_content}` (paths relativos a `dir`).
  """
  def search(dir, query) do
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
