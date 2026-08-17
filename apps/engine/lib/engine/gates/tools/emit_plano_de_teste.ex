defmodule Engine.Gates.Tools.EmitPlanoDeTeste do
  @moduledoc """
  Registra o plano de teste da QA-estratégia (ADR 0090; `docs/fluxo.yml`,
  papel `qa-estrategia`, segundo MOMENTO do `qa-lead`): `planoDeTeste`
  (síntese em prosa), `criteriosExecutaveis` (os critérios de aceite da
  story reescritos em forma VERIFICÁVEL) e `estrategiaDeAutomacao` — que
  fica GENÉRICA de propósito (nível de teste e onde, nunca framework
  específico — decisão de escopo desta frente, não regra validada em
  código: a instrução vive na `spec/0` que o modelo lê).

  Mesma fronteira de `Engine.Gates.Tools.EmitPerfSegurancaVerdict`: só
  aceita depois de ter lido algo do workspace (`read_file`/
  `search_workspace`) — um plano derivado só da descrição da story, sem
  olhar código nem módulo, seria genérico demais para valer o nome
  "estratégia".
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "emit_plano_de_teste",
      description:
        "Registra o plano de teste da story: síntese, critérios executáveis e " <>
          "estratégia de automação (nível de teste e onde — NUNCA escolha " <>
          "framework). Só aceito depois de ter lido algo do workspace.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "planoDeTeste" => %{
            "type" => "string",
            "description" => "síntese do que precisa ser verificado, em prosa"
          },
          "criteriosExecutaveis" => %{
            "type" => "array",
            "items" => %{"type" => "string"},
            "description" => "os critérios de aceite da story reescritos de forma verificável"
          },
          "estrategiaDeAutomacao" => %{
            "type" => "string",
            "description" =>
              "genérica: nível de teste (unidade/integração/e2e) e onde — sem framework"
          }
        },
        "required" => ["planoDeTeste", "criteriosExecutaveis", "estrategiaDeAutomacao"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"criteriosExecutaveis" => criterios}, ctx) when is_list(criterios) do
    cond do
      criterios == [] ->
        {:error, "criteriosExecutaveis não pode ser vazio — um plano sem critério não é plano"}

      not leu_algo?(Map.get(ctx, :messages, [])) ->
        {:error,
         "não é possível registrar o plano sem ter lido nada do workspace " <>
           "(read_file/search_workspace)"}

      true ->
        {:ok, "plano de teste registrado: #{length(criterios)} critério(s) executável(is)"}
    end
  end

  def run(_args, _ctx),
    do:
      {:error,
       "emit_plano_de_teste exige planoDeTeste, criteriosExecutaveis (lista não vazia) e estrategiaDeAutomacao"}

  defp leu_algo?(messages) do
    Enum.any?(messages, fn m ->
      Map.get(m, "role") == "tool" and Map.get(m, "name") in ["read_file", "search_workspace"]
    end)
  end
end
