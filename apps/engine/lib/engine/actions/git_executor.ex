defmodule Engine.Actions.GitExecutor do
  @moduledoc """
  Executa as ações git dos dev agents NO WORKTREE local (Fase 4a) — commit com
  identidade `dev-<modulo>[bot]` (usuário como co-author) e push pro bare repo
  local. Chamado pela api (pipeline de proposed_actions → engine), espelhando o
  TerminalExecutor. Toda operação git passa por `Engine.Actions.GitCmd`, que é
  quem garante que uma falha nunca chega vazia.
  """

  alias Engine.Actions.{GitAuth, GitCmd}
  alias Engine.Projects.ProjectRepository

  @doc """
  `git add -A` + commit no worktree, com author bot + Co-authored-by. `payload`
  (chaves string) precisa de `worktree` e `message`; `author`/`authorEmail`/
  `coAuthor` são opcionais. Retorna `{:ok, %{sha, branch}}`.
  """
  def commit(payload) do
    worktree = Map.fetch!(payload, "worktree")
    message = Map.get(payload, "message", "trabalho do dev agent")
    author = Map.get(payload, "author", "dev[bot]")
    author_email = Map.get(payload, "authorEmail", "dev-bot@brabo.dev")
    co_author = Map.get(payload, "coAuthor")

    body =
      if co_author, do: "#{message}\n\nCo-authored-by: #{co_author}", else: message

    with {:ok, _} <- git(worktree, ["add", "-A"]),
         {:ok, _} <-
           git(worktree, [
             "-c",
             "user.name=#{author}",
             "-c",
             "user.email=#{author_email}",
             "commit",
             "--author=#{author} <#{author_email}>",
             "-m",
             body
           ]),
         {:ok, sha} <- git(worktree, ["rev-parse", "HEAD"]),
         {:ok, branch} <- git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]) do
      {:ok, %{sha: String.trim(sha), branch: String.trim(branch)}}
    end
  end

  @doc """
  Push da branch pro `origin`. `payload` precisa de `worktree` e `branch`.

  A credencial entra por invocação (ADR 0056): o `origin` do worktree é a URL
  LIMPA, então empurrar num provider remoto sem passar por `GitAuth` falharia
  por autenticação. Para `local` não há token e o caminho é o de sempre.
  """
  def push(project_id, payload) do
    worktree = Map.fetch!(payload, "worktree")
    branch = Map.fetch!(payload, "branch")

    case ProjectRepository.remoto_de_trabalho(project_id) do
      {:ok, remoto} ->
        case GitAuth.run(worktree, ["push", "origin", branch], remoto) do
          {:ok, _} -> {:ok, %{branch: branch}}
          error -> error
        end

      {:error, reason} ->
        # Origem `infra`, e dita: token ausente ou api fora não é falha do
        # modelo nem do código do agente (CLAUDE.md, achados P/Q/T).
        {:error, "push não executou: remoto de trabalho indisponível (#{inspect(reason)})"}
    end
  end

  defp git(cd, args), do: GitCmd.run(cd, args)
end
