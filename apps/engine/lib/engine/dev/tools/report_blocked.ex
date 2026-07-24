defmodule Engine.Dev.Tools.ReportBlocked do
  @moduledoc """
  Sinaliza que o DevAgent NÃO consegue concluir a task e por quê — o modelo
  usa quando decide (após tentar) que está travado. Sempre aceito (não há o
  que enforçar num bloqueio); o hook `Engine.Dev.Hooks.Termination` termina o
  loop e o `DevAgentServer` devolve a task com o diagnóstico.
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "report_blocked",
      description: "Sinaliza que não é possível concluir a task e registra o diagnóstico.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "reason" => %{"type" => "string", "description" => "motivo curto do bloqueio"},
          "diagnosis" => %{
            "type" => "string",
            "description" => "diagnóstico detalhado — o que foi tentado, o que falhou"
          }
        },
        "required" => ["reason", "diagnosis"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"reason" => reason}, _ctx) when is_binary(reason) do
    {:ok, "bloqueio registrado: #{reason}"}
  end

  def run(_args, _ctx), do: {:error, "report_blocked exige `reason` e `diagnosis`"}
end
