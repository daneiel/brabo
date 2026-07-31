defmodule Engine.Infra.Tools.EmitInfraDelegationResult do
  @moduledoc """
  Sinaliza que um delegado da área de Infra (Fase 8c) terminou: devolve os
  arquivos gerados (`files`) e um resumo curto (`summary`), pro
  `InfraLeadServer` consolidar com o do outro delegado antes de propor a PR
  única. Mesma forma pro Lead (Dockerfiles/compose) e pro `WorkflowsAgent`
  (pipeline de CI) — o hook `Engine.Infra.Hooks.Termination` casa esta tool
  e extrai `files`/`summary` dos argumentos, igual
  `Engine.Gates.Hooks.Termination` faz com `emit_qa_verdict`/
  `emit_perf_seguranca_verdict`.

  Só aceita terminar depois de pelo menos um `validate_infra_file` no
  histórico — mesma disciplina de "reprovar nunca precisa de prova, terminar
  precisa" que `EmitPerfSegurancaVerdict` já usa, adaptada: aqui não há
  veredito bom/ruim, só "terminei", então a guarda é sobre TER validado, não
  sobre o resultado da validação.
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "emit_infra_delegation_result",
      description:
        "Sinaliza que terminou de gerar os arquivos desta delegação (Dockerfiles/compose " <>
          "ou pipeline de CI). Só aceito depois de validar cada arquivo com " <>
          "`validate_infra_file`.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "summary" => %{"type" => "string"},
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
        "required" => ["summary", "files"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"files" => files}, ctx) when is_list(files) and files != [] do
    if validou_algo?(Map.get(ctx, :messages, [])) do
      {:ok, "resultado registrado: #{length(files)} arquivo(s)."}
    else
      {:error,
       "não é possível terminar: nenhuma chamada a `validate_infra_file` encontrada no histórico"}
    end
  end

  def run(_args, _ctx),
    do: {:error, "emit_infra_delegation_result exige `summary` e `files` (não-vazio)"}

  defp validou_algo?(messages) do
    Enum.any?(messages, fn m ->
      Map.get(m, "role") == "tool" and Map.get(m, "name") == "validate_infra_file"
    end)
  end
end
