defmodule Engine.Harness.Tools.ProposeAdr do
  @moduledoc """
  Ferramenta do Arquiteto: propõe um ADR — cria uma proposed_action
  `open_adr_pr` (efeito git → pipeline de aprovação). Quando o usuário aprova, a
  api commita `docs/adr/<slug>.md` no repo do projeto e abre a PR real.
  `:pipeline` (não executa direto; nasce pending).

  Desde a RN-577 ela RECUSA localmente, ANTES de propor, quando o projeto não
  tem repositório (`ProjectRepository.recusa_de_pr_sem_repositorio/2`). Sob a
  RN-522 isso era o caso comum: o Arquiteto trabalhava ANTES do handoff ao Dev
  Lead, que era quem provisionava. Desde a RN-582 (ADR 0165) o repositório
  nasce no aceite do handoff AO Arquiteto, antes do primeiro turno dele, e a
  recusa passou a cobrir o que sobra — provisionamento que falhou no aceite, e
  projeto que passou pelo Arquiteto antes da regra. Sem a recusa, cada chamada virava uma `proposed_action` que o humano aprovava
  e que `ExecuteAdrPrUseCase` só podia terminar `failed` (AT-088). A recusa é
  resultado de ferramenta (RN-163) e deixa rastro durável: o `tool.call` o
  `ArquitetoServer` já emite antes de rodar a tool, e o motivo vai num
  `tool.result` com `ok: false` — a forma que o Criativo já usa.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Projects.ProjectRepository
  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "propose_adr",
      description:
        "Propõe um ADR (Architecture Decision Record) a ser commitado no repo do projeto " <>
          "via PR, sujeito à aprovação do usuário. `slug` vira docs/adr/<slug>.md e a branch " <>
          "feature/adr-<slug>. `content` é o markdown do ADR. `modules` lista os módulos do " <>
          "module_map a que a decisão se aplica — os dev agents desses módulos recebem o ADR " <>
          "no contexto. Omita (ou deixe vazio) quando a decisão for transversal ao projeto: " <>
          "aí ela vale pra todos os módulos.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "title" => %{"type" => "string"},
          "slug" => %{"type" => "string"},
          "content" => %{"type" => "string"},
          "modules" => %{"type" => "array", "items" => %{"type" => "string"}}
        },
        "required" => ["title", "slug", "content"]
      }
    }
  end

  @impl true
  def category, do: :pipeline

  @impl true
  def run(%{"title" => _, "slug" => _, "content" => _} = args, ctx) do
    case ProjectRepository.recusa_de_pr_sem_repositorio(ctx.project_id, "open_adr_pr") do
      nil ->
        propor(args, ctx)

      motivo ->
        EngineApiClient.append_event(ctx.project_id, ctx.session_id, %{
          type: "tool.result",
          actorKind: "agent",
          actorId: ctx.agent,
          payload: %{tool: "propose_adr", ok: false, erro: motivo}
        })

        {:error, motivo}
    end
  end

  def run(_args, _ctx), do: {:error, "propose_adr exige `title`, `slug` e `content`"}

  defp propor(%{"title" => title, "slug" => slug, "content" => content} = args, ctx) do
    actor = %{kind: "agent", id: ctx.agent}

    payload = %{
      title: title,
      slug: slug,
      content: content,
      # Vínculo ADR↔módulo (Fase 4a): lista vazia = decisão transversal, entra
      # no contexto de todos os dev agents.
      modules: Map.get(args, "modules", [])
    }

    case EngineApiClient.propose_action(
           ctx.project_id,
           ctx.session_id,
           "open_adr_pr",
           actor,
           payload
         ) do
      {:ok, %{"id" => id, "status" => status}} ->
        {:ok, "ADR proposta (ação #{id}, status=#{status}) — aguardando aprovação do usuário."}

      {:error, reason} ->
        {:error, "falha ao propor ADR: #{inspect(reason)}"}
    end
  end
end
