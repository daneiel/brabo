defmodule Engine.Actions.GitCmd do
  @moduledoc """
  Ponto único de chamada do binário `git` no engine — executor de ações,
  gerência de worktree e cálculo de diff dos gates.

  Existe por causa de um buraco de diagnóstico registrado como backlog do
  [ADR 0048]: `System.cmd/3` com `cd:` apontando para diretório inexistente
  **não levanta exceção** — devolve `{"", 2}` —, e um `{:error, ""}` chegava ao
  usuário como falha sem motivo nenhum. A causa raiz conhecida (worktree
  reciclado embaixo de uma ação pendente) foi fechada pela ordem do gate, mas o
  buraco valia para qualquer falha de diretório.

  Aqui toda falha nomeia o comando, o status e o diretório. A saída do git,
  quando existe, continua sendo o erro **verbatim**: quem já lia
  `nothing to commit` continua lendo.
  """

  @doc """
  Roda `git <args>` dentro de `cd`.

  `{:ok, saída}` no status 0. `{:error, diagnóstico}` em qualquer outro caso —
  inclusive diretório inexistente, que nem chega a executar.
  """
  @spec run(Path.t(), [String.t()]) :: {:ok, String.t()} | {:error, String.t()}
  def run(cd, args) do
    if File.dir?(cd) do
      case System.cmd("git", args, cd: cd, stderr_to_stdout: true) do
        {out, 0} -> {:ok, out}
        {out, status} -> {:error, diagnostico(cd, args, out, status)}
      end
    else
      {:error, "git #{comando(args)} não executou: diretório de trabalho não existe (#{cd})"}
    end
  end

  defp diagnostico(cd, args, out, status) do
    case String.trim(out) do
      "" -> "git #{comando(args)} falhou com status #{status} em #{cd}, sem nenhuma saída"
      _ -> out
    end
  end

  defp comando(args), do: Enum.join(args, " ")
end
