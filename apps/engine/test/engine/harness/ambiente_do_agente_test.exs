defmodule Engine.Harness.AmbienteDoAgenteTest do
  @moduledoc """
  RN-706 (AT-379/AT-378): o dev agent e o subagente de QA recebem, como
  mensagem de sistema EFÊMERA, onde estão — a pasta traduzida para o
  container, a imagem e a rede, que git no terminal não é o caminho, e o
  módulo dele.
  """

  use ExUnit.Case, async: true

  alias Engine.Harness.AmbienteDoAgente

  @raiz "/data/project-workspaces/loja"
  @imagem %{"image" => "node:22-bookworm-slim", "network" => "none"}

  test "caminho feliz: com container running, a pasta é /work/.worktrees/<agente>" do
    texto =
      AmbienteDoAgente.montar(%{
        cwd: @raiz <> "/.worktrees/dev-api",
        raiz: @raiz,
        container_running: true,
        imagem: @imagem,
        modulo: "api"
      })

    assert texto =~ "/work/.worktrees/dev-api"
    refute texto =~ @raiz
    assert texto =~ "node:22-bookworm-slim"
    assert texto =~ "rede `none`"
    assert texto =~ "git_commit"
    assert texto =~ "Seu módulo: `api`"
    assert texto =~ "package.json"
    assert String.length(texto) <= AmbienteDoAgente.teto_de_caracteres()
  end

  test "falha: sem container running, não afirma /work e diz que não há container" do
    texto =
      AmbienteDoAgente.montar(%{
        cwd: @raiz <> "/.worktrees/qa-automacao",
        raiz: @raiz,
        container_running: false,
        imagem: nil
      })

    refute texto =~ "/work"
    assert texto =~ "NÃO tem container `running`"
  end

  test "anexar: efêmera no fim só para dev-*/qa-*, e o dicionário é restaurado" do
    historico = [%{"role" => "user", "content" => "oi"}]
    Process.put(:brabo_ambiente_do_agente, "Ambiente X")

    try do
      assert List.last(AmbienteDoAgente.anexar(historico, "dev-api")) ==
               %{"role" => "system", "content" => "Ambiente X"}

      assert length(AmbienteDoAgente.anexar(historico, "qa-automacao")) == 2
      assert AmbienteDoAgente.anexar(historico, "po") == historico
    after
      Process.delete(:brabo_ambiente_do_agente)
    end

    assert AmbienteDoAgente.anexar(historico, "dev-api") == historico
  end
end
