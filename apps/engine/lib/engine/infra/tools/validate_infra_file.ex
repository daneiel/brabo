defmodule Engine.Infra.Tools.ValidateInfraFile do
  @moduledoc """
  Ferramenta do InfraAgent (Fase 4a): valida um Dockerfile via `hadolint`
  ANTES de propor a PR — `:direct`, sem proposed_action/policy (mesmo
  espírito dos detectors do SecOps: chamada direta, nunca passa pelo
  pipeline de ações). Binário ausente NUNCA quebra o turno — devolve uma
  mensagem informativa pro modelo seguir sem validar (CLAUDE.md "quando
  disponíveis no container").
  """

  @behaviour Engine.Harness.Tool

  defp detector,
    do: Application.get_env(:engine, :hadolint_detector, Engine.Actions.HadolintDetector.Live)

  @impl true
  def spec do
    %{
      name: "validate_infra_file",
      description:
        "Valida a sintaxe de um Dockerfile via hadolint antes de propor a PR de infra. " <>
          "Use antes de `propose_infra_pr` pra cada Dockerfile gerado.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "content" => %{"type" => "string"}
        },
        "required" => ["content"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"content" => content}, _ctx) do
    det = detector()

    if det.available?() do
      case det.lint(content) do
        {:ok, []} -> {:ok, "hadolint: nenhum achado."}
        {:ok, findings} -> {:ok, "hadolint: #{length(findings)} achado(s): #{format(findings)}"}
        {:error, reason} -> {:ok, "hadolint falhou (#{inspect(reason)}), seguindo sem validar."}
        :unavailable -> {:ok, "hadolint indisponível, seguindo sem validar."}
      end
    else
      {:ok, "hadolint indisponível, seguindo sem validar."}
    end
  end

  def run(_args, _ctx), do: {:error, "validate_infra_file exige `content`"}

  defp format(findings),
    do: Enum.map_join(findings, "; ", fn f -> "linha #{f.line}: #{f.message}" end)
end
