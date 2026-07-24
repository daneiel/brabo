defmodule Engine.Harness.Tools do
  @moduledoc """
  Registro das ferramentas do ToolLoop. `specs/0` gera as definições que vão
  pro modelo (tool calling); `find/1` acha o módulo por nome; `registry/0`
  lista os módulos.
  """

  alias Engine.Harness.Tools.{ReadFile, SearchWorkspace, WriteFile, Terminal, EmitArtifact}

  @registry [ReadFile, SearchWorkspace, WriteFile, Terminal, EmitArtifact]

  @doc "Módulos de ferramenta registrados."
  def registry, do: @registry

  @doc "Definições das ferramentas pro modelo (name/description/parameters)."
  def specs, do: Enum.map(@registry, & &1.spec())

  @doc "Módulo da ferramenta pelo nome, ou `nil`."
  def find(name) do
    Enum.find(@registry, fn mod -> mod.spec().name == name end)
  end
end
