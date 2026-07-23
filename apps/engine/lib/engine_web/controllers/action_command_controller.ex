defmodule EngineWeb.ActionCommandController do
  use EngineWeb, :controller

  alias Engine.Actions.TerminalExecutor

  # Chaves de resposta em camelCase explícito — nunca repassa o mapa
  # snake_case interno direto pro Jason (mesmo cuidado já levado com
  # PsychologistWorker: atom snake_case vira string snake_case no JSON,
  # não camelCase, e o DTO da api espera camelCase).
  def execute(conn, %{"projectId" => project_id, "command" => command}) do
    result = TerminalExecutor.run(project_id, command)

    json(conn, %{
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exit_code,
      timedOut: result.timed_out,
      rawBytes: result.raw_bytes,
      estimatedTokensRaw: result.estimated_tokens_raw,
      compressedBytes: result.compressed_bytes,
      estimatedTokensCompressed: result.estimated_tokens_compressed
    })
  end
end
