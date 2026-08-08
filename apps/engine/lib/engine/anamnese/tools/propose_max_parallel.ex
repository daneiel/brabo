defmodule Engine.Anamnese.Tools.ProposeMaxParallel do
  @moduledoc """
  Ferramenta OPCIONAL da Anamnese (FASE 14d, item 4): quando autorizar mais um
  agente virou ROTINA, propõe subir o teto da área.

  O sinal já chega no contexto da rodada — as `decisions` da janela trazem as
  aprovações e negações do usuário, com `actionType`. Um punhado de
  `parallelize` aprovados e nenhum negado é o teto dizendo que está errado.

  `:direct` com endpoint dedicado, como o `propose_instruction_patch`: a api
  precisa saber o teto vigente para recusar uma proposta que não sobe nada —
  lógica de domínio que fica testável em TS. A `proposed_action` nasce lá
  dentro, pelo pipeline normal, e **nunca é auto-aprovável** (teto em
  `decide.ts`). Esse teto é o ponto: automatizar o ajuste seria o produto
  elevando o próprio limite de gasto.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "propose_max_parallel",
      description:
        "Propõe subir o teto de agentes simultâneos de uma área. Use SÓ quando as " <>
          "decisões da janela mostrarem que autorizar mais um agente virou rotina — " <>
          "várias aprovações do mesmo pedido, sem negação. O usuário decide; a " <>
          "proposta nunca se aprova sozinha. Propor um teto igual ou menor que o " <>
          "vigente é recusado.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "area" => %{
            "type" => "string",
            "description" => "a área cujo teto subiria (ex.: dev, qa)"
          },
          "proposto" => %{
            "type" => "integer",
            "minimum" => 1,
            "description" => "o teto proposto, MAIOR que o vigente"
          },
          "rationale" => %{
            "type" => "string",
            "description" =>
              "por que, ancorado nas DECISÕES observadas na janela (quantas vezes o " <>
                "usuário aprovou, e que nenhuma foi negada) — não em impressão"
          }
        },
        "required" => ["area", "proposto", "rationale"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(
        %{"area" => area, "proposto" => proposto, "rationale" => rationale},
        ctx
      ) do
    payload = %{area: area, proposto: proposto, rationale: rationale}

    case EngineApiClient.propose_max_parallel(ctx.project_id, ctx.session_id, payload) do
      {:ok, %{"id" => id, "status" => status}} ->
        {:ok,
         "proposta de subir o teto da área #{area} para #{proposto} criada " <>
           "(ação #{id}, status=#{status}) — aguardando o usuário decidir."}

      {:ok, _outro} ->
        {:ok, "proposta de teto para a área #{area} criada."}

      {:error, reason} ->
        {:error, "proposta recusada: #{Engine.Anamnese.Tools.describe(reason)}"}
    end
  end

  def run(_args, _ctx),
    do: {:error, "propose_max_parallel exige `area`, `proposto` e `rationale`"}
end
