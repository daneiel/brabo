defmodule Engine.Dev.ReportDoneInstrucaoTest do
  @moduledoc """
  RN-832 (AT-499): o dev agent sabe que `report_done` faz commit, push e PR —
  não procura `git_commit`/`git_push`/`pr_open` nem bloqueia por falta delas —
  e que teste novo entra no script `test` que lista arquivos.
  """

  use ExUnit.Case, async: true

  alias Engine.Dev.DevAgentServer
  alias Engine.Dev.Tools.{ReportBlocked, ReportDone}
  alias Engine.Harness.AmbienteDoAgente

  test "caminho feliz: report_done, kickoff e ambiente carregam as duas instruções" do
    assert ReportDone.spec().description =~ "commit, o push e abre a PR"
    assert ReportDone.spec().description =~ "git_commit"
    assert ReportBlocked.spec().description =~ "falta ferramenta de git"

    kickoff =
      DevAgentServer.initial_message(%{"title" => "T"}, %{"title" => "S"})["content"]

    assert kickoff =~ "`report_done` faz o commit, o push e abre a PR"
    assert kickoff =~ "inclua nele todo arquivo de teste novo"

    ambiente =
      AmbienteDoAgente.montar(%{
        cwd: "/r/.worktrees/dev-api",
        raiz: "/r",
        container_running: true
      })

    assert ambiente =~ "report_done"
    assert ambiente =~ "inclua nele todo arquivo de teste novo"
  end

  test "falha: o ambiente não manda mais usar as ações tipadas de git" do
    ambiente = AmbienteDoAgente.montar(%{cwd: nil, raiz: nil, container_running: false})
    refute ambiente =~ "Use as ações tipadas"
  end
end
