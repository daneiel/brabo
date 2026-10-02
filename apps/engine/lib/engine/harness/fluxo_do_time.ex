defmodule Engine.Harness.FluxoDoTime do
  @moduledoc """
  ONDE o agente conversacional está no fluxo de entrega, o PRÓXIMO passo real
  e QUEM o dispara (humano × sistema) — RN-711, AT-369. Entregue como
  mensagem `system` EFÊMERA pela fachada `Engine.Sessions.EngineApiClient`,
  no MESMO molde do ambiente (RN-706), do perfil (RN-680) e do idioma
  (RN-622): nunca em `state.messages`, nunca por servidor, nunca uma lista à
  mão por prompt.

  Medido no uso real (02/10): o Criativo dizia que o próximo era o Arquiteto
  (é o PO), o PO que o Arquiteto ia "implementar" as histórias, o Arquiteto
  que "dev agents começam" depois dos ADRs, e a Infra prometia pipeline de
  deploy. Cada prompt narrava um fluxo diferente porque ninguém o dizia.

  Fonte ÚNICA: `@etapas`, abaixo. O `docs/fluxo.yml` (ADR 0085) não carrega
  QUEM dispara cada passagem nem o texto para o modelo, então a sequência
  mora aqui e o teste (`fluxo_do_time_test.exs`) a confere contra o
  `fluxo.yml`: todo papel citado tem de existir lá com `status: active`, e
  o texto não pode nomear etapa/agente fora dele.
  """

  # `papel` é o id do papel no `docs/fluxo.yml`; `nome` é como o texto o cita.
  @etapas [
    %{
      agente: "criativo",
      papel: "criativo",
      nome: "Criativo",
      faz: "conduz a ideação e registra regras de negócio",
      saida:
        "o humano clica \"Estou pronto — a necessidade está validada\"; o SISTEMA então põe o PO na conversa"
    },
    %{
      agente: "po",
      papel: "po",
      nome: "PO",
      faz: "transforma a necessidade em épico, histórias e tarefas",
      saida:
        "o PO oferece o handoff ao Arquiteto; o humano aceita (ou o SISTEMA aceita sozinho com o backlog coberto)"
    },
    %{
      agente: "arquiteto",
      papel: "arquiteto",
      nome: "Arquiteto",
      faz:
        "define módulos, roteamento para infra, contratos e a imagem do container (não implementa)",
      saida:
        "o humano confirma UMA vez \"arquitetura pronta\"; o SISTEMA oferece então o handoff à Infra"
    },
    %{
      agente: "infra",
      papel: "area-infra",
      nome: "Infra",
      faz: "no aceite, o SISTEMA sobe o container do projeto sozinho (pelo broker)",
      saida: "com o container `running`, o SISTEMA oferece o Dev Lead; o humano aceita"
    },
    %{
      agente: "dev-lead",
      papel: "dev-lead",
      nome: "Dev Lead",
      faz: "propõe o plano de execução (tarefa → módulo)",
      saida: "o humano APROVA o plano, e a aprovação ATIVA a execução"
    },
    %{
      agente: nil,
      papel: "dev",
      nome: "dev agents",
      faz: "implementam cada tarefa no seu módulo e abrem PR para `dev`",
      saida: "o SISTEMA roda os gates"
    },
    %{
      agente: nil,
      papel: "area-qa",
      nome: "QA e SecOps",
      faz: "julgam a PR (gates)",
      saida: "o MERGE é sempre manual, do humano"
    }
  ]

  # Conversacionais fora da linha principal: dizem onde a linha está, sem
  # fingir que são uma etapa dela.
  @laterais %{
    "ux-designer" => %{papel: "ux-designer", nome: "UX Designer"},
    "staff" => %{papel: "staff", nome: "Staff"}
  }

  @doc "As etapas da linha principal, na ordem."
  def etapas, do: @etapas

  @doc "Os conversacionais laterais (fora da linha principal)."
  def laterais, do: @laterais

  @doc "Todo papel (id do `docs/fluxo.yml`) que o texto pode citar."
  def papeis, do: Enum.map(@etapas, & &1.papel) ++ Enum.map(Map.values(@laterais), & &1.papel)

  @doc "A lista com o texto do fluxo no FIM, ou intacta para quem não conversa."
  @spec anexar([map()], String.t()) :: [map()]
  def anexar(messages, agent) when is_list(messages) do
    case texto(agent) do
      nil -> messages
      t -> messages ++ [%{"role" => "system", "content" => t}]
    end
  end

  def anexar(messages, _agent), do: messages

  @doc "O texto do fluxo para o agente, ou `nil` se ele não é conversacional."
  def texto(agent) do
    cond do
      idx = Enum.find_index(@etapas, &(&1.agente == agent)) ->
        etapa = Enum.at(@etapas, idx)

        cabecalho() <>
          "Você é a etapa #{idx + 1} (#{etapa.nome}): #{etapa.faz}. " <>
          "Próximo passo real: #{etapa.saida}. Não anuncie outro próximo passo, " <>
          "não pule etapas e não peça de novo uma confirmação que o humano já deu."

      lateral = Map.get(@laterais, agent) ->
        cabecalho() <>
          "Você (#{lateral.nome}) não é uma etapa desta linha: não anuncie passagem a outro agente."

      true ->
        nil
    end
  end

  defp cabecalho do
    linha =
      @etapas
      |> Enum.with_index(1)
      |> Enum.map_join("\n", fn {e, i} -> "#{i}. #{e.nome}: #{e.faz} → #{e.saida}." end)

    "Fluxo de entrega do Brabo (fato do sistema; quem dispara cada passagem está dito):\n" <>
      linha <> "\n"
  end
end
