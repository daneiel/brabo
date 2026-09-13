defmodule EngineWeb.ActionCommandController do
  use EngineWeb, :controller

  alias Engine.Actions.{TerminalExecutor, GitExecutor}
  alias Engine.Runners.Espelho

  # Chaves de resposta em camelCase explícito — nunca repassa o mapa
  # snake_case interno direto pro Jason (mesmo cuidado já levado com
  # PsychologistWorker: atom snake_case vira string snake_case no JSON,
  # não camelCase, e o DTO da api espera camelCase).
  def execute(conn, %{"projectId" => project_id, "command" => command} = params) do
    result = TerminalExecutor.run(project_id, command, cwd: Map.get(params, "cwd"))

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
  #
  # O COMMIT é o momento nomeado que dispara o espelho (ADR 0147 ponto 8,
  # RN-516) — nunca um watcher do outro lado, que seria trabalho ilimitado
  # disparado por qualquer coisa, inclusive pelas escritas do próprio espelho.
  # Só no SUCESSO: commit que falhou não mudou nada que valha copiar.
  #
  # `projectId` já vinha no corpo desde sempre (ver o comentário de
  # `git_push`), e é lido com `Map.get` em vez de entrar no pattern match para
  # um corpo sem ele continuar commitando como sempre — `sincronizar/2` trata
  # `nil` como "não há o que sincronizar". Ela nunca levanta e nunca bloqueia:
  # projeto sem espelho (o caso normal) devolve `{:erro, :sem_destino}` e o
  # commit responde exatamente como antes.
  def execute_git(conn, %{"type" => "git_commit", "payload" => payload} = params) do
    case GitExecutor.commit(payload) do
      {:ok, %{sha: sha, branch: branch}} ->
        Espelho.sincronizar(Map.get(params, "projectId"), "commit")
        json(conn, %{sha: sha, branch: branch})

      {:error, out} ->
        conn |> put_status(422) |> json(%{error: to_string(out)})
    end
  end

  # `projectId` já vinha no corpo desde sempre — o ADR 0056 é que passou a
  # precisar dele: sem saber o projeto não há como pedir o remoto de trabalho, e
  # o push num provider remoto falharia por falta de credencial.
  def execute_git(conn, %{"type" => "git_push", "projectId" => project_id, "payload" => payload}) do
    case GitExecutor.push(project_id, payload) do
      {:ok, %{branch: branch}} -> json(conn, %{branch: branch})
      {:error, out} -> conn |> put_status(422) |> json(%{error: to_string(out)})
    end
  end
end
