defmodule Engine.Infra.Tools.ProposeContainerStart do
  @moduledoc """
  Spec da ferramenta `propose_container_start` — pro modelo do Infra Lead
  (ADR 0131/RN-487 deu o roteamento; este é o PR 1.5, quem ELEGE). O
  Arquiteto candidata uma imagem por módulo via `route_modules_to_infra`
  (`artifact.module_routing`); esta tool elege UMA dessas candidatas — nunca
  uma imagem fora da lista — e propõe subir o container real do projeto.

  Diferente de `propose_infra_pr`, `InfraLeadServer.dispatch_calls/2`
  intercepta esta tool também, mas NÃO consolida com o `WorkflowsAgent`: é
  ação independente, despachada inline (`propose_action(..., "container_start",
  ...)`), sem HALT — o turno continua e o modelo pode chamar `propose_infra_pr`
  antes, depois, ou nunca chamar esta.

  `run/2` fica só como salvaguarda de behaviour (`@behaviour
  Engine.Harness.Tool` exige as três callbacks) — NUNCA deveria ser chamado
  de verdade, porque o servidor intercepta antes.
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "propose_container_start",
      description:
        "Propõe subir o container real do projeto, elegendo UMA das imagens candidatas " <>
          "que o Arquiteto roteou por módulo (`route_modules_to_infra`, ADR 0131) — nunca " <>
          "inventando uma imagem fora dessa lista. Diferente de `propose_infra_pr`, esta " <>
          "ação exige aprovação humana explícita, sempre.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "imagem" => %{
            "type" => "string",
            "description" =>
              "Uma das `imagemCandidata` do roteamento vigente — nunca uma imagem fora da lista."
          },
          "network" => %{
            "type" => "string",
            "enum" => ["none", "egress"],
            "description" => "Postura de rede do container. Default \"none\"."
          },
          "resources" => %{
            "type" => "object",
            "description" => "Teto de recursos: cpus, memoryMb, pidsLimit. Omitir usa o padrão.",
            "properties" => %{
              "cpus" => %{"type" => "number"},
              "memoryMb" => %{"type" => "number"},
              "pidsLimit" => %{"type" => "number"}
            }
          },
          "rationale" => %{
            "type" => "string",
            "description" => "Por que ESTA candidata — mínimo 10 caracteres (validado pela api)."
          }
        },
        "required" => ["imagem", "rationale"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(_args, _ctx),
    do:
      {:error,
       "propose_container_start é interceptada pelo InfraLeadServer antes de chegar aqui — " <>
         "run/2 nunca deveria ser invocado"}
end
