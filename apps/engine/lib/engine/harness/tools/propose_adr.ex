defmodule Engine.Harness.Tools.ProposeAdr do
  @moduledoc """
  Ferramenta do Arquiteto: propõe um ADR — cria uma proposed_action
  `open_adr_pr` (efeito git → pipeline de aprovação). Quando o usuário aprova, a
  api commita `docs/adr/<slug>.md` no repo do projeto e abre a PR real.
  `:pipeline` (não executa direto; nasce pending).
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "propose_adr",
      description:
        "Propõe um ADR (Architecture Decision Record) a ser commitado no repo do projeto " <>
          "via PR, sujeito à aprovação do usuário. `slug` vira docs/adr/<slug>.md e a branch " <>
          "feature/adr-<slug>. `content` é o markdown do ADR.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "title" => %{"type" => "string"},
          "slug" => %{"type" => "string"},
          "content" => %{"type" => "string"}
        },
        "required" => ["title", "slug", "content"]
      }
    }
  end

  @impl true
  def category, do: :pipeline

  @impl true
  def run(%{"title" => title, "slug" => slug, "content" => content}, ctx) do
    actor = %{kind: "agent", id: ctx.agent}
    payload = %{title: title, slug: slug, content: content}

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

  def run(_args, _ctx), do: {:error, "propose_adr exige `title`, `slug` e `content`"}
end
