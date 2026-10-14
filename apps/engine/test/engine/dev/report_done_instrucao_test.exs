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

  test "RN-846: kickoff pede a rota no README e erro de entrada próprio" do
    kickoff =
      DevAgentServer.initial_message(%{"title" => "T"}, %{"title" => "S"})["content"]

    assert kickoff =~ "Rota HTTP criada ou mudada entra no README"
    assert kickoff =~ "nunca a mensagem crua da biblioteca"

    refute AmbienteDoAgente.montar(%{cwd: nil, raiz: nil, container_running: false}) =~
             "Rota HTTP criada"
  end

  test "RN-850: a rota vai dentro de Rotas HTTP e o README não leva nota de processo" do
    kickoff =
      DevAgentServer.initial_message(%{"title" => "T"}, %{"title" => "S"})["content"]

    assert kickoff =~ ~s(DENTRO da seção "Rotas HTTP")
    assert kickoff =~ "nunca no fim do arquivo"
    assert kickoff =~ "sem nota de processo nem instrução para agentes"
    refute kickoff =~ "deve ser documentado nesta seção"
  end

  test "falha: o ambiente não manda mais usar as ações tipadas de git" do
    ambiente = AmbienteDoAgente.montar(%{cwd: nil, raiz: nil, container_running: false})
    refute ambiente =~ "Use as ações tipadas"
  end

  test "RN-853: tarefa que toca rotas pede /openapi.json e /docs" do
    kickoff =
      DevAgentServer.initial_message(%{"title" => "Criar rotas de links"}, %{"title" => "S"})[
        "content"
      ]

    assert kickoff =~ "`/openapi.json` (OpenAPI 3"
    assert kickoff =~ "TODA rota HTTP criada ou mudada nesta tarefa entra nele"
    assert kickoff =~ "swagger-ui de CDN"
    assert kickoff =~ "\"Rodar na sua máquina\""
  end

  test "RN-853 falha: tarefa sem rota nem entrypoint não paga a cláusula" do
    kickoff =
      DevAgentServer.initial_message(%{"title" => "Modelar tabela"}, %{"title" => "S"})["content"]

    refute kickoff =~ "openapi.json"
  end

  test "RN-879/880: tarefa que toca rotas leva URL com porta, code único e CORS" do
    kickoff =
      DevAgentServer.initial_message(%{"title" => "Criar rotas de links"}, %{"title" => "S"})[
        "content"
      ]

    assert kickoff =~ "`PUBLIC_BASE_URL`"
    assert kickoff =~ "MESMO `code` em todas as rotas"
    assert kickoff =~ "`CORS_ORIGINS`"
    assert kickoff =~ "`servers` só relativo (`/`)"
    assert kickoff =~ "versão EXATA"
  end

  test "RN-879/880 falha: tarefa sem rota não recebe CORS nem PUBLIC_BASE_URL" do
    kickoff =
      DevAgentServer.initial_message(%{"title" => "Modelar tabela"}, %{"title" => "S"})["content"]

    refute kickoff =~ "CORS_ORIGINS"
    refute kickoff =~ "PUBLIC_BASE_URL"
  end
end
