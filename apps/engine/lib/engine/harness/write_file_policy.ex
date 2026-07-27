defmodule Engine.Harness.WriteFilePolicy do
  @moduledoc """
  Whitelist de paths de escrita por agente (Fase 3a). Dentro da whitelist o
  write_file escreve direto; fora, vira `proposed_action` (aprovação humana).
  Mapa `slug do agente → lista de prefixos permitidos`, configurável via
  `config :engine, :write_file_whitelist`. Default mínimo — o EchoAgent pode
  escrever em `scratch/`.

  Além do mapa por slug EXATO, há uma lista de **prefixos de agente**
  (`config :engine, :write_file_agent_prefixes`, default `["dev-"]`) que libera
  escrita em qualquer caminho da raiz do agente. Existe porque os dev agents
  têm slug dinâmico (`dev-api`, `dev-web`, `dev-api-2`) e não cabem num mapa
  fixo — e porque, pra eles, o sandbox NÃO é a lista de prefixos de path: é o
  `workspace_root`, que é o worktree isolado do agente. Sair dele é barrado por
  `Engine.Harness.WorkspaceFiles.write_file/3` (`{:error, :traversal}`), que
  resolve o path e recusa qualquer coisa fora da raiz.

  Sem isso o DevAgent real não implementa nada: todo `write_file` viraria
  `proposed_action` pendente (e `write_file` sequer tem executor na api), então
  ele nunca chegaria numa suite verde — a condição que `Engine.Dev.Tools.ReportDone`
  exige pra abrir PR.
  """

  @default_whitelist %{"echo" => ["scratch/"]}
  @default_agent_prefixes ["dev-"]

  @doc "Se o agente pode escrever em `rel_path` diretamente (sem proposed_action)."
  def allowed?(agent, rel_path) do
    agent_by_prefix?(agent) or path_whitelisted?(agent, rel_path)
  end

  # Agente cuja raiz JÁ é o sandbox (worktree) — escreve em qualquer path dela.
  defp agent_by_prefix?(agent) do
    Enum.any?(agent_prefixes(), &String.starts_with?(agent, &1))
  end

  defp path_whitelisted?(agent, rel_path) do
    whitelist()
    |> Map.get(agent, [])
    |> Enum.any?(&String.starts_with?(rel_path, &1))
  end

  defp whitelist do
    Application.get_env(:engine, :write_file_whitelist, @default_whitelist)
  end

  defp agent_prefixes do
    Application.get_env(:engine, :write_file_agent_prefixes, @default_agent_prefixes)
  end
end
