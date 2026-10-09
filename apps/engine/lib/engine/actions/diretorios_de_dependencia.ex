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

  @doc "A lista, na ordem do `.gitignore` base."
  def diretorios, do: @diretorios

  @doc """
  Argumentos de `git add` que estagiam tudo MENOS esses diretórios, em
  qualquer profundidade (pathspec `:(exclude,glob)`).
  """
  def argumentos_do_add do
    ["add", "-A", "--", "."] ++ Enum.map(@diretorios, &":(exclude,glob)**/#{&1}/**")
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
