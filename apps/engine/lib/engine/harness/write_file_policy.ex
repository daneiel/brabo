defmodule Engine.Harness.WriteFilePolicy do
  @moduledoc """
  Whitelist de paths de escrita por agente (Fase 3a). Dentro da whitelist o
  write_file escreve direto; fora, vira `proposed_action` (aprovação humana).
  Mapa `slug do agente → lista de prefixos permitidos`, configurável via
  `config :engine, :write_file_whitelist`. Default mínimo — o EchoAgent pode
  escrever em `scratch/`.
  """

  @default_whitelist %{"echo" => ["scratch/"]}

  @doc "Se o agente pode escrever em `rel_path` diretamente (sem proposed_action)."
  def allowed?(agent, rel_path) do
    whitelist()
    |> Map.get(agent, [])
    |> Enum.any?(&String.starts_with?(rel_path, &1))
  end

  defp whitelist do
    Application.get_env(:engine, :write_file_whitelist, @default_whitelist)
  end
end
