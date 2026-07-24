defmodule Engine.Dev.Naming do
  @moduledoc """
  Deriva o agent_id de um dev a partir do nome do módulo (Fase 4a). PRECISA
  bater com o slug da api (`devAgentId` em activate-execution.use-case.ts) — o
  agent_id liga a autonomia seedada (api) ao processo (engine).
  """

  def dev_agent_id(module) do
    slug =
      module
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9]+/, "-")
      |> String.trim("-")

    "dev-" <> slug
  end

  @doc "agent_id do subagente extra do mesmo módulo (paralelização)."
  def extra_agent_id(module), do: dev_agent_id(module) <> "-2"
end
