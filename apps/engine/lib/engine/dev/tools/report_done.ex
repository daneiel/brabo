defmodule Engine.Dev.Tools.ReportDone do
  @moduledoc """
  Sinaliza que o DevAgent concluiu a task — ENFORÇADO, não confiado ao LLM: só
  aceito se a ÚLTIMA mensagem `tool` "terminal" no histórico começar com
  "exit 0" (formato exato de
  `Engine.Harness.Hooks.ActionPipeline.terminal_result/1`, resultado de rodar
  a suite via a ferramenta `terminal`). Sem isso, devolve erro — o modelo tenta
  de novo, NUNCA sinaliza conclusão sem suite verde comprovada. O halt real do
  loop acontece no hook `Engine.Dev.Hooks.Termination` (`:post_tool_use`),
  quando este `run/2` teve sucesso.
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "report_done",
      description:
        "Sinaliza que a task está pronta pra abrir PR. Só aceito se o último " <>
          "comando `terminal` rodado (a suite de testes) tiver saído com exit 0.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "summary" => %{
            "type" => "string",
            "description" => "resumo do que foi implementado"
          }
        },
        "required" => ["summary"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(_args, ctx) do
    case last_terminal_content(Map.get(ctx, :messages, [])) do
      "exit 0" <> _ ->
        {:ok, "conclusão registrada — suite verde confirmada"}

      _ ->
        {:error,
         "não é possível concluir: nenhum `terminal` com exit 0 (suite verde) encontrado no histórico"}
    end
  end

  defp last_terminal_content(messages) do
    messages
    |> Enum.filter(&(Map.get(&1, "role") == "tool" and Map.get(&1, "name") == "terminal"))
    |> List.last()
    |> case do
      nil -> nil
      msg -> Map.get(msg, "content")
    end
  end
end
