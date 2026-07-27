defmodule EngineWeb.InstructionCommandController do
  @moduledoc """
  Invalidação do cache de instruções (Fase 4b) — a api chama depois de um
  `instruction_patch` aprovado ou de um rollback, senão os agentes
  seguiriam servindo o conteúdo antigo em memória.

  Limpa TODAS as raízes do agente (workspace compartilhado + worktrees
  dos devs). Agentes que montam o prompt a cada run (dev-*, QA, SecOps,
  Psicólogo, Anamnese) pegam a mudança na próxima execução; os
  conversacionais, que congelam o system prompt no init, pegam ao
  reiniciar — limitação documentada no ADR 0016.
  """

  use EngineWeb, :controller

  alias Engine.Harness.InstructionFiles

  def invalidate(conn, %{"projectId" => project_id, "agent" => agent}) do
    :ok = InstructionFiles.invalidate_all(project_id, agent)
    send_resp(conn, 204, "")
  end
end
