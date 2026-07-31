defmodule Engine.Gates.Tools.EmitPerfSegurancaVerdict do
  @moduledoc """
  Registra o parecer da subespecialidade QA de Performance e Segurança (Fase
  8b): `veredito` (`approved`/`changes_requested`) e `resumo`/`itens` — mesma
  forma de `Engine.Gates.Tools.EmitQaVerdict`, sem `coverageMatrix` (não faz
  sentido pra revisão de RNF/código: não há regra→teste a mapear).

  ## Por que a guarda de aprovação é outra

  `EmitQaVerdict` só aceita `approved` com um `terminal` de exit 0 no
  histórico — prova de suite verde. Esta subespecialidade não
  necessariamente roda nada em `terminal` (o registro de ferramentas dela
  nem inclui `Terminal` — ver `Engine.Gates.QaPerformanceSegurancaAgent`); ela
  é revisão de leitura. A guarda análoga aqui é: só aprova se já usou
  `read_file` ou `search_workspace` pelo menos uma vez — a mesma ideia
  ("reprovar nunca precisa de prova; aprovar precisa"), adaptada à ferramenta
  que esta subespecialidade de fato usa.
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "emit_perf_seguranca_verdict",
      description:
        "Registra o parecer de Performance/Segurança (aprovado ou mudanças solicitadas). " <>
          "Só aceito aprovar depois de ter lido algo do workspace.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "veredito" => %{
            "type" => "string",
            "enum" => ["approved", "changes_requested"]
          },
          "resumo" => %{"type" => "string"},
          "itens" => %{"type" => "array", "items" => %{"type" => "string"}}
        },
        "required" => ["veredito", "resumo", "itens"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"veredito" => "approved"} = _args, ctx) do
    if leu_algo?(Map.get(ctx, :messages, [])) do
      {:ok, "parecer registrado: aprovado"}
    else
      {:error,
       "não é possível aprovar: nenhuma leitura (`read_file`/`search_workspace`) encontrada no histórico"}
    end
  end

  def run(%{"veredito" => "changes_requested"}, _ctx) do
    {:ok, "parecer registrado: mudanças solicitadas"}
  end

  def run(_args, _ctx),
    do: {:error, "emit_perf_seguranca_verdict exige veredito, resumo e itens"}

  defp leu_algo?(messages) do
    Enum.any?(messages, fn m ->
      Map.get(m, "role") == "tool" and Map.get(m, "name") in ["read_file", "search_workspace"]
    end)
  end
end
