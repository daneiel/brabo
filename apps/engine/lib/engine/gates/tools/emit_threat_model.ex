defmodule Engine.Gates.Tools.EmitThreatModel do
  @moduledoc """
  Registra o threat model de DESIGN do appsec (RN-360, `docs/fluxo.yml`
  `id: appsec`, ADR 0090) — o checklist STRIDE-lite (`threatModel`), os
  requisitos de segurança que a implementação vai ter que cumprir
  (`requisitosSeguranca`) e os riscos que sobrevivem mesmo assim (`riscos`).

  Sem guarda de "só aprova depois de ler algo" (ao contrário de
  `EmitPerfSegurancaVerdict`): não há veredito approved/changes_requested
  aqui — o appsec sempre TERMINA emitindo o threat model, e o contexto de
  story + module_map já vem pronto no prompt (leitura de arquivo é reforço
  opcional, não pré-condição pra concluir).
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "emit_threat_model",
      description:
        "Registra o threat model de design (checklist STRIDE-lite) e os requisitos " <>
          "de segurança derivados, antes de existir código/PR.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "threatModel" => %{
            "type" => "string",
            "description" =>
              "Checklist nas seis categorias STRIDE (Spoofing, Tampering, " <>
                "Repudiation, Information disclosure, Denial of service, " <>
                "Elevation of privilege) — o que cada uma encontrou, ou por " <>
                "que não se aplica ao desenho da story."
          },
          "requisitosSeguranca" => %{
            "type" => "array",
            "items" => %{"type" => "string"},
            "description" => "O que a implementação vai ter que fazer por causa disto."
          },
          "riscos" => %{
            "type" => "array",
            "items" => %{"type" => "string"},
            "description" =>
              "Riscos que sobrevivem mesmo com os requisitos atendidos. Lista " <>
                "vazia é resposta válida — nem toda story carrega risco residual."
          }
        },
        "required" => ["threatModel", "requisitosSeguranca", "riscos"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"threatModel" => threat_model} = args, _ctx)
      when is_binary(threat_model) and threat_model != "" do
    if is_list(Map.get(args, "requisitosSeguranca")) and is_list(Map.get(args, "riscos")) do
      {:ok, "threat model registrado"}
    else
      {:error, "emit_threat_model exige requisitosSeguranca e riscos como listas"}
    end
  end

  def run(_args, _ctx),
    do: {:error, "emit_threat_model exige threatModel (não vazio), requisitosSeguranca e riscos"}
end
