defmodule Engine.Gates.Tools.EmitQaVerdict do
  @moduledoc """
  Registra o parecer do QAAgent (Fase 4a): `veredito` (`approved`/
  `changes_requested`), `resumo`, `itens` (regras sem teste, falhas) e a
  `coverageMatrix` (regra → testes que a cobrem). ENFORÇADO como
  `Engine.Dev.Tools.ReportDone`: só aceita `approved` se a ÚLTIMA mensagem
  `tool` "terminal" no histórico começar com "exit 0" — `changes_requested`
  é sempre aceito (reprovar nunca precisa de prova).
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "emit_qa_verdict",
      description:
        "Registra o parecer de QA (aprovado ou mudanças solicitadas) com a matriz " <>
          "de cobertura regra→testes. Só aceito aprovar com a suite verde (exit 0). " <>
          "`needs_user_decision` quando o requisito depende de decisão do usuário: " <>
          "exige `pergunta` (e a sua `sugestao`) ou `openQuestionId` de uma pergunta existente.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "veredito" => %{
            "type" => "string",
            "enum" => ["approved", "changes_requested", "needs_user_decision"]
          },
          "pergunta" => %{"type" => "string"},
          "sugestao" => %{"type" => "string"},
          "openQuestionId" => %{"type" => "string"},
          "resumo" => %{"type" => "string"},
          "itens" => %{"type" => "array", "items" => %{"type" => "string"}},
          "coverageMatrix" => %{
            "type" => "array",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "rule" => %{"type" => "string"},
                "tests" => %{"type" => "array", "items" => %{"type" => "string"}},
                "covered" => %{"type" => "boolean"}
              },
              "required" => ["rule", "tests", "covered"]
            }
          }
        },
        "required" => ["veredito", "resumo", "itens", "coverageMatrix"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"veredito" => "approved"} = _args, ctx) do
    case last_terminal_content(Map.get(ctx, :messages, [])) do
      "exit 0" <> _ ->
        {:ok, "parecer registrado: aprovado"}

      _ ->
        {:error,
         "não é possível aprovar: nenhum `terminal` com exit 0 (suite verde) encontrado no histórico"}
    end
  end

  def run(%{"veredito" => "changes_requested"}, _ctx) do
    {:ok, "parecer registrado: mudanças solicitadas"}
  end

  # ADR 0214 (RN-862): requisito não confirmado pelo usuário não é defeito do
  # dev — é pergunta. Sem pergunta nem pergunta existente, é recusa nomeada.
  def run(%{"veredito" => "needs_user_decision"} = args, _ctx) do
    pergunta = Map.get(args, "pergunta")
    existente = Map.get(args, "openQuestionId")

    if (is_binary(pergunta) and String.trim(pergunta) != "") or
         (is_binary(existente) and existente != ""),
       do: {:ok, "parecer registrado: decisão do usuário pedida"},
       else:
         {:error,
          "needs_user_decision exige `pergunta` (com a sua `sugestao`) ou `openQuestionId`"}
  end

  def run(_args, _ctx),
    do: {:error, "emit_qa_verdict exige veredito, resumo, itens e coverageMatrix"}

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
