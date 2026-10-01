defmodule Engine.Harness.Tools.OfferHandoff do
  @moduledoc """
  Ferramenta pra um agente OFERECER um handoff ao próximo (Fase 3b). Usada pelo
  PO pra passar o bastão ao Arquiteto quando o backlog está pronto. Cria um
  handoff `offered` na api (o usuário aceita depois, ativando o agente destino).
  Exceção (RN-660, ADR 0186): PO → Arquiteto com backlog coberto e repositório
  local é aceito pela própria api, e a ferramenta diz isso ao modelo.
  `:direct`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "offer_handoff",
      description:
        "Oferece um handoff ao próximo agente (ex.: to_agent=\"arquiteto\"). O usuário aceita " <>
          "o handoff pra ativar o agente destino.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "to_agent" => %{"type" => "string"},
          "artifact_id" => %{"type" => "string"}
        },
        "required" => ["to_agent"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"to_agent" => to_agent} = args, ctx) do
    artifact_id = Map.get(args, "artifact_id")

    case EngineApiClient.create_handoff(
           ctx.project_id,
           ctx.session_id,
           ctx.agent,
           to_agent,
           artifact_id
         ) do
      # ADR 0182 (RN-635): a api devolve a oferta que JÁ estava pendente em vez
      # de criar outra — dizer "oferecido" de novo faria o modelo achar que
      # passou o bastão duas vezes.
      {:ok, %{"desfecho" => "ja_oferecido"}} ->
        {:ok,
         "já havia um handoff pendente a #{to_agent} — nenhum novo foi criado; " <>
           "continua aguardando o usuário aceitar."}

      # RN-660 (ADR 0186): o handoff do PO ao Arquiteto é aceito pelo SISTEMA
      # quando o backlog está coberto e o repositório é local. Dizer
      # "aguardando o usuário" aqui faria o modelo esperar um clique que não
      # vem — e ofertar de novo daria 409 `agente_ja_ativo`.
      {:ok, %{"aceiteAutomatico" => %{"aceito" => true}}} ->
        {:ok,
         "handoff a #{to_agent} aceito automaticamente: o backlog cobre todas as " <>
           "regras de negócio e o repositório é local — #{to_agent} já foi ativado. " <>
           "Não ofereça de novo."}

      {:ok, _handoff} ->
        {:ok, "handoff oferecido a #{to_agent} — aguardando o usuário aceitar."}

      # Recusa NOMEADA: o destino já está ativo no projeto. A frase da api é o
      # que o modelo lê (RN-163), nunca o `inspect` do corpo.
      {:error, {409, %{"reason" => "agente_ja_ativo", "message" => mensagem}}} ->
        {:error, mensagem}

      {:error, reason} ->
        {:error, "falha ao oferecer handoff: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "offer_handoff exige `to_agent`"}
end
