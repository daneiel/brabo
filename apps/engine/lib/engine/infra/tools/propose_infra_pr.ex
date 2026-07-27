defmodule Engine.Infra.Tools.ProposeInfraPr do
  @moduledoc """
  Ferramenta do InfraAgent (Fase 4a): propõe a proposed_action `open_infra_pr`
  — commita N arquivos (Dockerfiles/compose/CI) e abre PR real. Mirror de
  `Engine.Harness.Tools.ProposeAdr`, generalizado pra vários arquivos.
  `:pipeline` (passa pelo decide()/permissions da api). O InfraAgent tem
  `agent_autonomy (infra, open_infra_pr) = auto_approve` seedado no accept do
  handoff — então normalmente já vem `status: "executed"` com a PR aberta.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient
  alias Engine.Gates.Dispatcher

  @impl true
  def spec do
    %{
      name: "propose_infra_pr",
      description:
        "Propõe a PR de infra: commita os arquivos de infra (Dockerfiles/compose/CI) numa " <>
          "branch e abre uma PR real no repo do projeto.",
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
  def category, do: :pipeline

  @impl true
  def run(%{"title" => title, "files" => files}, ctx) do
    actor = %{kind: "agent", id: ctx.agent}
    payload = %{title: title, files: files}

    case EngineApiClient.propose_action(
           ctx.project_id,
           ctx.session_id,
           "open_infra_pr",
           actor,
           payload
         ) do
      {:ok, %{"id" => id, "status" => "executed"} = action} ->
        url = get_in(action, ["executionResult", "pullRequestUrl"]) || "(sem url)"
        Dispatcher.run_infra_qa(ctx.project_id, ctx.session_id, id)
        {:ok, "PR de infra aberta: #{url} — gates de QA/SecOps disparados."}

      {:ok, %{"id" => id, "status" => status}} ->
        {:ok,
         "PR de infra proposta (ação #{id}, status=#{status}) — aguardando aprovação do usuário."}

      {:error, reason} ->
        {:error, "falha ao propor PR de infra: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "propose_infra_pr exige `title` e `files`"}
end
