defmodule Engine.Actions.GitleaksDetectorTest do
  @moduledoc """
  Testes do detector REAL contra o binário do container. São a regressão do
  defeito central do ADR 0020: o detector varria o LOG DE COMMITS (`gitleaks
  detect`), então um segredo já removido da árvore continuava sendo achado pra
  sempre e o gate de SecOps nunca podia ser satisfeito.

  A tag `:gitleaks` é excluída automaticamente quando o binário não está
  instalado (ver `test_helper.exs`) — o caminho "scanner ausente" já tem
  cobertura com o Fake em `secops_agent_server_test.exs`.
  """
  use ExUnit.Case, async: true

  @moduletag :gitleaks

  alias Engine.Actions.GitleaksDetector.Live

  # Um PAT do GitHub falso: as regras default do gitleaks pegam `ghp_` por
  # formato + entropia, sem a allowlist de valores-exemplo que atrapalha
  # chaves da AWS (`AKIA...EXAMPLE`).
  @segredo "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"

  setup do
    dir =
      Path.join(System.tmp_dir!(), "brabo-gitleaks-test-#{System.unique_integer([:positive])}")

    File.mkdir_p!(dir)
    git!(dir, ["init", "-q", "."])
    git!(dir, ["config", "user.email", "dev-bot@brabo.dev"])
    git!(dir, ["config", "user.name", "dev-bot"])

    on_exit(fn -> File.rm_rf!(dir) end)

    {:ok, dir: dir}
  end

  test "segredo presente na árvore de trabalho: achado com caminho relativo", %{dir: dir} do
    escreve_e_commita(dir, ~s(const TOKEN = "#{@segredo}";\n), "feat: cliente")

    assert {:ok, [finding]} = Live.scan(dir)
    assert finding.tool == "gitleaks"
    # Relativo ao worktree: `gitleaks dir` reporta caminho absoluto, e o
    # parecer vai pro usuário e pro prompt de correção do dev.
    assert finding.path == "cliente.js"
    assert finding.line == 1
    assert is_binary(finding.message)
  end

  test "segredo só num commit ancestral, já removido da árvore: NENHUM achado", %{dir: dir} do
    # Exatamente o fluxo do gate: o dev commita o segredo, o SecOps reprova, o
    # dev corrige num commit NOVO. Com `gitleaks detect` (histórico) isto
    # devolvia 1 achado pra sempre — a task estourava o teto de correções e
    # virava `blocked`, tornando o critério de aceite inalcançável.
    escreve_e_commita(dir, ~s(const TOKEN = "#{@segredo}";\n), "feat: cliente")
    escreve_e_commita(dir, "const TOKEN = process.env.TOKEN;\n", "fix: segredo via env")

    assert {:ok, []} = Live.scan(dir)
  end

  defp escreve_e_commita(dir, conteudo, mensagem) do
    File.write!(Path.join(dir, "cliente.js"), conteudo)
    git!(dir, ["add", "-A"])
    git!(dir, ["commit", "-qm", mensagem])
  end

  defp git!(dir, args) do
    {_output, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
    :ok
  end
end
