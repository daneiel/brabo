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
end
