defmodule Engine.Actions.GitCmdTest do
  # async: false — filesystem + git de verdade, como o resto das suites de
  # ação. Sem banco.
  use ExUnit.Case, async: false

  alias Engine.Actions.GitCmd

  setup do
    dir =
      Path.join(
        System.tmp_dir!(),
        "brabo-gitcmd-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(dir)
    {_, 0} = System.cmd("git", ["init"], cd: dir, stderr_to_stdout: true)

    on_exit(fn -> File.rm_rf!(dir) end)

    %{dir: dir}
  end

  test "caminho feliz devolve a saída do git", %{dir: dir} do
    assert {:ok, out} = GitCmd.run(dir, ["rev-parse", "--is-inside-work-tree"])
    assert String.trim(out) == "true"
  end

  test "falha com saída do git preserva a mensagem verbatim", %{dir: dir} do
    assert {:error, out} = GitCmd.run(dir, ["rev-parse", "--verify", "nao-existe"])
    assert out =~ "nao-existe"
  end

  test "diretório inexistente diz isso, em vez de falhar em branco" do
    sumido = Path.join(System.tmp_dir!(), "brabo-gitcmd-sumido-#{System.unique_integer()}")
    refute File.dir?(sumido)

    assert {:error, motivo} = GitCmd.run(sumido, ["add", "-A"])

    # O defeito original: `System.cmd` com `cd:` inexistente devolve `{"", 2}`,
    # e isso virava `{:error, ""}` — falha sem diagnóstico nenhum.
    refute motivo == ""
    assert motivo =~ "diretório de trabalho não existe"
    assert motivo =~ sumido
    assert motivo =~ "git add -A"
  end

  test "falha sem saída nenhuma nomeia comando, status e diretório", %{dir: dir} do
    # `git cat-file -e <sha inexistente>` sai 1 com stdout E stderr vazios — é
    # o caso que produzia `{:error, ""}` por outro caminho que não o do
    # diretório sumido.
    sha = String.duplicate("0", 40)

    assert {:error, motivo} = GitCmd.run(dir, ["cat-file", "-e", sha])

    refute String.trim(motivo) == ""
    assert motivo =~ "cat-file -e #{sha}"
    assert motivo =~ "status 1"
    assert motivo =~ dir
  end
end
