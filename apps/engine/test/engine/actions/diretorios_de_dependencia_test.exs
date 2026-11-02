defmodule Engine.Actions.DiretoriosDeDependenciaTest do
  # RN-761 (AT-446)
  use ExUnit.Case, async: true

  alias Engine.Actions.DiretoriosDeDependencia
  alias Engine.Gates.SecOpsAgentServer

  @templates Path.expand(
               "../../../../api/src/application/use-cases/git/bootstrap-templates.ts",
               __DIR__
             )

  test "a lista é a mesma do .gitignore base do bootstrap da api" do
    [_, bloco] = Regex.run(~r/DIRETORIOS_DE_DEPENDENCIA = \[(.*?)\]/s, File.read!(@templates))
    da_api = Regex.scan(~r/'([^']+)'/, bloco, capture: :all_but_first) |> List.flatten()
    assert da_api == DiretoriosDeDependencia.diretorios()
  end

  test "commitados/1 acha o diretório em qualquer profundidade, e só ele" do
    assert DiretoriosDeDependencia.commitados(["web/node_modules/a.js", "src/x.ts"]) ==
             ["node_modules"]

    assert DiretoriosDeDependencia.commitados(["src/node_modules_util.ts"]) == []
  end

  test "o SecOps acusa node_modules no diff como achado, com a contagem" do
    [achado] =
      SecOpsAgentServer.dependencias_commitadas([
        "node_modules/a.js",
        "node_modules/b.js",
        "x.ts"
      ])

    assert achado.path == "node_modules"
    assert achado.message =~ "2 arquivo(s)"
    assert SecOpsAgentServer.dependencias_commitadas(["x.ts"]) == []
  end

  test "RN-948: a lista de arquivos de dados é a da api, e o add os exclui" do
    [_, bloco] = Regex.run(~r/ARQUIVOS_DE_DADOS = \[(.*?)\]/s, File.read!(@templates))
    da_api = Regex.scan(~r/'([^']+)'/, bloco, capture: :all_but_first) |> List.flatten()
    assert da_api == DiretoriosDeDependencia.arquivos_de_dados()

    args = DiretoriosDeDependencia.argumentos_do_add()
    for pad <- da_api, do: assert(":(exclude,glob)**/#{pad}" in args)
  end

  test "RN-948: o SecOps nomeia o arquivo de dados commitado" do
    achados = SecOpsAgentServer.dependencias_commitadas(["m/encurtador.db", "m/src/a.js"])
    assert [%{path: "m/encurtador.db", message: msg}] = achados
    assert msg =~ "arquivo de dados"
    assert SecOpsAgentServer.dependencias_commitadas(["m/src/a.js"]) == []
  end

  test "RN-948: o add estagia só o que não é dado (worktree de verdade)" do
    dir = Path.join(System.tmp_dir!(), "brabo-add-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(dir, "src"))
    on_exit(fn -> File.rm_rf!(dir) end)

    for f <- ["src/a.db", "a.db-wal", "x.sqlite3", "src/a.js"],
        do: File.write!(Path.join(dir, f), "x")

    {_, 0} = System.cmd("git", ["init", "-q"], cd: dir)
    {_, 0} = System.cmd("git", DiretoriosDeDependencia.argumentos_do_add(), cd: dir)
    {out, 0} = System.cmd("git", ["diff", "--cached", "--name-only"], cd: dir)
    assert String.split(out, "\n", trim: true) == ["src/a.js"]
  end
end
