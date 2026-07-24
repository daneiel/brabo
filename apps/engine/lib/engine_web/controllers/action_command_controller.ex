defmodule EngineWeb.ActionCommandController do
  use EngineWeb, :controller

  alias Engine.Actions.{TerminalExecutor, GitExecutor}

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

  # Fase 4a: git_commit/git_push no worktree do dev agent (a api roteia pra cá).
  def execute_git(conn, %{"type" => "git_commit", "payload" => payload}) do
    case GitExecutor.commit(payload) do
      {:ok, %{sha: sha, branch: branch}} -> json(conn, %{sha: sha, branch: branch})
      {:error, out} -> conn |> put_status(422) |> json(%{error: to_string(out)})
    end
  end

  def execute_git(conn, %{"type" => "git_push", "payload" => payload}) do
    case GitExecutor.push(payload) do
      {:ok, %{branch: branch}} -> json(conn, %{branch: branch})
      {:error, out} -> conn |> put_status(422) |> json(%{error: to_string(out)})
    end
  end
end
