defmodule Engine.Actions.DiretoriosDeDependencia do
  @moduledoc """
  RN-761 (AT-446). Diretórios de dependência instalada e de build que o
  commit de um agente nunca leva, com ou sem `.gitignore` no repositório.
  A MESMA lista é a do `.gitignore` base do bootstrap
  (`DIRETORIOS_DE_DEPENDENCIA` em
  `apps/api/src/application/use-cases/git/bootstrap-templates.ts`), conferida
  por teste dos dois lados.
  """

  @diretorios ~w(node_modules deps _build .venv venv __pycache__ vendor target)

  # RN-948 (AT-623): arquivos de dados em tempo de execução (SQLite) também
  # não entram no commit. Mesma lista de `ARQUIVOS_DE_DADOS` na api.
  @arquivos_de_dados ~w(*.db *.db-* *.sqlite *.sqlite-* *.sqlite3 *.sqlite3-*)

  @doc "A lista, na ordem do `.gitignore` base."
  def diretorios, do: @diretorios

  @doc "Os padrões de arquivo de dados, na ordem do `.gitignore` base."
  def arquivos_de_dados, do: @arquivos_de_dados

  @doc "Os caminhos do conjunto cujo nome casa com um padrão de arquivo de dados."
  def dados_commitados(paths) when is_list(paths) do
    res =
      Enum.map(@arquivos_de_dados, fn pad ->
        Regex.compile!("^" <> String.replace(Regex.escape(pad), "\\*", ".*") <> "$")
      end)

    Enum.filter(paths, fn p -> Enum.any?(res, &Regex.match?(&1, Path.basename(p))) end)
  end

  @doc """
  Argumentos de `git add` que estagiam tudo MENOS esses diretórios, em
  qualquer profundidade (pathspec `:(exclude,glob)`).
  """
  def argumentos_do_add do
    ["add", "-A", "--", "."] ++
      Enum.map(@diretorios, &":(exclude,glob)**/#{&1}/**") ++
      Enum.map(@arquivos_de_dados, &":(exclude,glob)**/#{&1}")
  end

  @doc """
  Os diretórios de dependência que aparecem num conjunto de caminhos (o diff
  de uma PR). Lista vazia quando nenhum.
  """
  def commitados(paths) when is_list(paths) do
    Enum.filter(@diretorios, fn dir ->
      Enum.any?(paths, fn path -> dir in Path.split(path) end)
    end)
  end
end
