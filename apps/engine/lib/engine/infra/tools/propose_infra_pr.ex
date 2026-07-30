defmodule Engine.Infra.Tools.ProposeInfraPr do
  @moduledoc """
  Spec da ferramenta `propose_infra_pr` — pro modelo do Infra Lead. Até a
  Fase 8c, `run/2` chamava a api direto (`open_infra_pr`) assim que o
  modelo terminava. Desde a Fase 8c, `Engine.Infra.InfraLeadServer.
  dispatch_calls/2` INTERCEPTA esta tool ANTES de chegar em `run/2` — o
  turno halts e devolve `{title, files}` pro servidor, que consolida com o
  `WorkflowsAgent` e só então chama `propose_action(..., "open_infra_pr",
  ...)` (a chamada que vivia aqui, agora em `InfraLeadServer.abrir_pr/3`) —
  uma vez, com a UNIÃO dos arquivos dos dois delegados.

  `spec/0` continua igual: o modelo não percebe diferença nenhuma. `run/2`
  fica só como salvaguarda de behaviour (`@behaviour Engine.Harness.Tool`
  exige as três callbacks) — NUNCA deveria ser chamado de verdade, porque o
  servidor intercepta antes.
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "propose_infra_pr",
      description:
        "Propõe a PR de infra: commita os arquivos de infra (Dockerfiles/compose) numa " <>
          "branch e abre uma PR real no repo do projeto, junto com o pipeline de CI que o " <>
          "Workflows gera.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "title" => %{"type" => "string"},
          "files" => %{
            "type" => "array",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "path" => %{"type" => "string"},
                "content" => %{"type" => "string"}
              },
              "required" => ["path", "content"]
            }
          }
        },
        "required" => ["title", "files"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(_args, _ctx),
    do:
      {:error,
       "propose_infra_pr é interceptada pelo InfraLeadServer antes de chegar aqui — " <>
         "run/2 nunca deveria ser invocado"}
end
