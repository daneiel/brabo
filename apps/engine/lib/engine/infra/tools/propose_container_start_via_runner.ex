defmodule Engine.Infra.Tools.ProposeContainerStartViaRunner do
  @moduledoc """
  Spec da ferramenta `container_start_via_runner` — pro modelo do Infra Lead
  (RN-506, ADR 0145). Segundo caminho para subir o container real do
  projeto, EXCLUSIVO de `execution_mode: runner` (`mounted` segue por
  `propose_container_start`, o broker, desde a RN-503).

  Diferente de `propose_container_start`, esta tool NÃO ELEGE imagem
  nenhuma — o que sobe é a que já estiver DECIDIDA
  (`ObterSpecDeContainerUseCase`, do lado da api), porque não há roteamento
  de módulos que faça sentido aqui: o broker nunca alcança a pasta de um
  projeto `runner` (ela mora na máquina do usuário), então não há candidata
  para eleger contra. Por isso o schema não tem `imagem`/`network`/
  `resources` — pedir 3 campos que o dispatch sempre descartaria é
  exatamente o defeito que motivou nascer uma tool separada, em vez de
  `propose_container_start` "inteligente" ramificando por modo.

  `Engine.Infra.InfraLeadServer.dispatch_container_start_via_runner/2`
  intercepta esta tool e CONSULTA LOCALMENTE (sem HTTP — `Project.get/1` e
  `Engine.Runners.Registry.connected?/1` rodam no MESMO processo BEAM) o
  `execution_mode` e a presença de um runner conectado, ANTES de propor —
  recusando com motivo NOMEADO em vez de propor às cegas (a lacuna que a
  RN-494 deixou declarada para `propose_container_start` continua aberta lá,
  mas não se repete aqui: esta tool nasce sabendo negar).

  `run/2` fica só como salvaguarda de behaviour (`@behaviour
  Engine.Harness.Tool` exige as três callbacks) — NUNCA deveria ser chamado
  de verdade, porque o servidor intercepta antes.
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "container_start_via_runner",
      description:
        "Propõe subir o container real do projeto NA MÁQUINA DO USUÁRIO, via " <>
          "`brabo-runner` — exclusivo de projeto no modo `runner`. Não elege " <>
          "imagem nenhuma: sobe a que já estiver decidida. Para `mounted`, use " <>
          "`propose_container_start` (o broker).",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "rationale" => %{
            "type" => "string",
            "description" => "Por que subir agora (opcional) — texto livre, sem mínimo."
          }
        },
        "required" => []
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(_args, _ctx),
    do:
      {:error,
       "container_start_via_runner é interceptada pelo InfraLeadServer antes de chegar " <>
         "aqui — run/2 nunca deveria ser invocado"}
end
