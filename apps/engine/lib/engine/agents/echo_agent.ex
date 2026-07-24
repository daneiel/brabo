defmodule Engine.Agents.EchoAgent do
  @moduledoc """
  Agente mínimo de validação do harness completo (Fase 3a) — não é um agente
  de produto (esses são 3b). Recebe uma tarefa, roda o `ToolLoop` com um
  modelo real do Ollama e as ferramentas registradas, força uma compactação
  (janela de contexto pequena) e termina limpo. Chamável do IEx pro critério
  de aceite; toda LLM passa pela api (metering).

  Pré-requisitos da demo: a sessão precisa estar ATIVA (a api já chamou
  `POST /internal/sessions`), com binding de modelo pra sessão e binding do
  agent "context-manager" pra um modelo barato.
  """

  alias Engine.Harness.ToolLoop

  @task """
  Você é um agente de validação. Faça, em passos, usando as ferramentas:
  1) leia o arquivo AGENTS.md do workspace com read_file;
  2) emita um artefato do tipo "note" com emit_artifact, com {title, body}
     resumindo o que leu.
  Depois responda "pronto".
  """

  @doc """
  Roda o ciclo completo do harness pra (session_id, project_id). Síncrono
  (bloqueia o chamador até terminar) pra o event log ficar observável logo
  depois no IEx. Retorna `{:ok, ctx}` ou `{:limit_reached, ctx}`.
  """
  def run(session_id, project_id) do
    ToolLoop.run(%{
      session_id: session_id,
      project_id: project_id,
      agent: "echo",
      messages: [%{"role" => "user", "content" => @task, :pinned => true}],
      max_iterations: 6,
      # Janela pequena pra forçar `context.compacted` cedo (assim que houver
      # turnos não-pinned além do keep_recent).
      context_window: 40,
      compaction_keep_recent: 1
    })
  end
end
