defmodule Engine.Infra.Tools.ValidateInfraFile do
  @moduledoc """
  Ferramenta de infra (Fase 4a; generalizada na Fase 8c): valida um arquivo
  ANTES de propor a PR — `:direct`, sem proposed_action/policy (mesmo
  espírito dos detectors do SecOps: chamada direta, nunca passa pelo
  pipeline de ações). Binário ausente NUNCA quebra o turno — devolve uma
  mensagem informativa pro modelo seguir sem validar (CLAUDE.md "quando
  disponíveis no container"). Usada tanto pelo Lead (Dockerfiles/compose)
  quanto pelo Workflows (pipeline de CI).

  O detector é escolhido pelo `path`, não pelo `content`:

    * `Dockerfile*` → hadolint (Fase 4a)
    * `.github/workflows/*.{yml,yaml}` → actionlint (Fase 8c)
    * `.gitlab-ci.yml` → SEM validação local — não existe linter estático
      offline equivalente pro GitLab CI (o oficial precisa de uma instância
      viva). Gap documentado no ADR 0039, não meia-solução inventada.
    * qualquer outro caminho (ex.: `docker-compose.yml`) → sem validação
      aqui; o gate de infra pós-PR (`InfraGateRunner`) já cobre YAML
      genérico via `yamllint`.
  """

  @behaviour Engine.Harness.Tool

  defp hadolint,
    do: Application.get_env(:engine, :hadolint_detector, Engine.Actions.HadolintDetector.Live)

  defp actionlint,
    do: Application.get_env(:engine, :actionlint_detector, Engine.Actions.ActionlintDetector.Live)

  @impl true
  def spec do
    %{
      name: "validate_infra_file",
      description:
        "Valida a sintaxe de um arquivo de infra antes de propor a PR: hadolint pra " <>
          "Dockerfile, actionlint pra workflow do GitHub Actions. Use antes de " <>
          "`propose_infra_pr`/`emit_infra_delegation_result` pra cada arquivo gerado.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "path" => %{"type" => "string"},
          "content" => %{"type" => "string"}
        },
        "required" => ["path", "content"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"path" => path, "content" => content}, _ctx) do
    cond do
      dockerfile?(path) ->
        lint(hadolint(), "hadolint", content)

      github_workflow?(path) ->
        lint(actionlint(), "actionlint", content)

      gitlab_ci?(path) ->
        {:ok, "sem linter estático local pra .gitlab-ci.yml — seguindo sem validar."}

      true ->
        {:ok,
         "#{path}: nada a validar localmente aqui (gate de infra cobre YAML genérico depois)."}
    end
  end

  def run(_args, _ctx), do: {:error, "validate_infra_file exige `path` e `content`"}

  defp lint(det, nome, content) do
    if det.available?() do
      case det.lint(content) do
        {:ok, []} -> {:ok, "#{nome}: nenhum achado."}
        {:ok, findings} -> {:ok, "#{nome}: #{length(findings)} achado(s): #{format(findings)}"}
        {:error, reason} -> {:ok, "#{nome} falhou (#{inspect(reason)}), seguindo sem validar."}
        :unavailable -> {:ok, "#{nome} indisponível, seguindo sem validar."}
      end
    else
      {:ok, "#{nome} indisponível, seguindo sem validar."}
    end
  end

  defp dockerfile?(path),
    do: path |> Path.basename() |> String.downcase() |> String.contains?("dockerfile")

  defp github_workflow?(path) do
    String.contains?(path, ".github/workflows/") and
      Path.extname(path) |> String.downcase() |> then(&(&1 in [".yml", ".yaml"]))
  end

  defp gitlab_ci?(path), do: Path.basename(path) == ".gitlab-ci.yml"

  defp format(findings),
    do: Enum.map_join(findings, "; ", fn f -> "linha #{f.line}: #{f.message}" end)
end
