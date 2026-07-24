defmodule Engine.Harness.Tools.Terminal do
  @moduledoc """
  Roda um comando de terminal SEMPRE via o pipeline de ações existente: o hook
  `:pre_tool_use` (ActionPipeline) cria um `proposed_action` `terminal` na api,
  que decide (permissions.json) e auto-executa quando `auto_approved`. O
  resultado vem do hook — `run/2` nunca é chamado (é `:pipeline`).
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "terminal",
      description:
        "Executa um comando de shell no workspace do projeto (via pipeline de aprovação).",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "command" => %{"type" => "string"}
        },
        "required" => ["command"]
      }
    }
  end

  @impl true
  def category, do: :pipeline

  # Nunca alcançado: ferramentas :pipeline têm o resultado produzido pelo hook
  # ActionPipeline. Defensivo, caso alguém remova o hook.
  @impl true
  def run(_args, _ctx),
    do: {:error, "terminal deve passar pelo pipeline de ações (hook pre_tool_use)"}
end
