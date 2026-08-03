defmodule Engine.Actions.GitExecutor do
  @moduledoc """
  Executa as ações git dos dev agents NO WORKTREE local (Fase 4a) — commit com
  identidade `dev-<modulo>[bot]` (usuário como co-author) e push pro bare repo
  local. Chamado pela api (pipeline de proposed_actions → engine), espelhando o
  TerminalExecutor. Toda operação git passa por `Engine.Actions.GitCmd`, que é
  quem garante que uma falha nunca chega vazia.
  """

  alias Engine.Actions.GitCmd

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

  @doc "Push da branch pro origin (o bare repo local). `payload` precisa de `worktree` e `branch`."
  def push(payload) do
    worktree = Map.fetch!(payload, "worktree")
    branch = Map.fetch!(payload, "branch")

    case git(worktree, ["push", "origin", branch]) do
      {:ok, _} -> {:ok, %{branch: branch}}
      error -> error
    end
  end

  defp git(cd, args), do: GitCmd.run(cd, args)
end
