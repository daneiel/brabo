defmodule Engine.Runners.RunnerReadiness do
  @moduledoc """
  As TRÊS pré-condições que um projeto `execution_mode: runner` precisa ter
  para qualquer comando alcançar a máquina do usuário — a MESMA pergunta que
  `Engine.Actions.TerminalExecutor` sempre respondeu para rotear terminal
  (RN-423/ADR 0104), com o predicado que a RN-505 (ADR 0145) acrescentou:
  container REGISTRADO `running`
  (`Engine.Containers.ProjectContainerLifecycle.running?/1`), unificando
  `runner` com `container`/`mounted` desde a RN-502 (ADR 0143) — Docker deixa
  de ser opcional para o modo `runner`, sem fallback pro host puro.

  Ganha um SEGUNDO consumidor com esta entrega:
  `Engine.Actions.Workspace.RunnerGit`, que materializa o worktree do dev
  agent (`git init`/`fetch`/`checkout`/`worktree add`) pelo MESMO canal
  Phoenix que já executa comando de terminal aprovado — antes disso, ele
  bloqueava um ESTOURO de exceção contra o filesystem do próprio engine
  (RN-478), nunca checava se havia runner nenhum do outro lado.

  Não são duas derivações — mesmo raciocínio do moduledoc de
  `Engine.Containers.ProjectContainerLifecycle`: é esta função, com dois
  consumidores, respondendo a mesma pergunta na mesma ordem.
  """

  alias Engine.Containers.ProjectContainerLifecycle
  alias Engine.Projects.Project
  alias Engine.Runners.Registry

  @type motivo :: :nao_verificado | :desconectado | :sem_container

  @doc """
  `:pronto` só quando o projeto está em modo `runner`, o workspace foi
  CONFIRMADO (`workspace_verified_at` não-nulo — o runner confirmou o
  caminho no host pelo menos uma vez), há um runner CONECTADO agora
  (`Engine.Runners.Registry`) e um container REGISTRADO `running`
  (`Engine.Containers.ProjectContainerLifecycle`). `{:erro, motivo}` para a
  PRIMEIRA pré-condição que faltar, sempre na mesma ordem.

  Projeto que não existe, id malformado, ou que não está em modo `runner`
  também caem em `{:erro, :nao_verificado}` — não é bem o caso de uso deste
  módulo (chamadores já sabem que o projeto é `runner` antes de perguntar),
  mas nunca `:pronto` por omissão.
  """
  @spec verificar(String.t()) :: :pronto | {:erro, motivo()}
  def verificar(project_id) do
    case Project.get(project_id) do
      %{execution_mode: "runner", workspace_verified_at: nil} ->
        {:erro, :nao_verificado}

      %{execution_mode: "runner"} ->
        cond do
          not Registry.connected?(project_id) -> {:erro, :desconectado}
          not ProjectContainerLifecycle.running?(project_id) -> {:erro, :sem_container}
          true -> :pronto
        end

      _ ->
        {:erro, :nao_verificado}
    end
  rescue
    _ -> {:erro, :nao_verificado}
  end

  @doc """
  `true` só quando `verificar/1` devolve `:pronto` — atalho booleano para
  quem só precisa decidir se tenta ou pula (o job periódico de limpeza de
  worktree, `Engine.Dev.WorktreeCleanup`, que precisa PULAR em silêncio, não
  falhar, quando não dá pra saber agora).
  """
  @spec pronto?(String.t()) :: boolean()
  def pronto?(project_id), do: verificar(project_id) == :pronto

  @doc "Mensagem nomeada por motivo — a MESMA linguagem que `TerminalExecutor` sempre usou."
  @spec mensagem(motivo(), String.t()) :: String.t()
  def mensagem(:nao_verificado, project_id) do
    "projeto no modo \"runner\" ainda não teve o workspace confirmado " <>
      "— rode `brabo-runner --project #{project_id} --dir <pasta>` na " <>
      "sua máquina antes de tentar de novo (RN-423)."
  end

  def mensagem(:desconectado, project_id) do
    "workspace já confirmado, mas nenhum runner está conectado a " <>
      "este projeto agora — rode `brabo-runner --project #{project_id} " <>
      "--dir <pasta>` na sua máquina e tente de novo."
  end

  def mensagem(:sem_container, _project_id) do
    "workspace confirmado e runner conectado, mas o projeto não tem " <>
      "container REGISTRADO como `running` na sua máquina (RN-505) — " <>
      "Docker virou pré-requisito real do modo runner, sem fallback " <>
      "pro host. Peça à Infra para propor `container_start_via_runner` " <>
      "e, depois de aprovado, tente de novo."
  end
end
