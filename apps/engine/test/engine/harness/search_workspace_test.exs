defmodule Engine.Harness.Tools.SearchWorkspaceTest do
  @moduledoc """
  O achado X da FASE 13b, na frase que o causou.

  Numa task sobre repositório recém-provisionado (só o template do Gitflow,
  sem código), o dev agent leu `nenhum resultado` como "refine a busca".
  Repetiu cinco buscas, queimou as oito iterações e foi bloqueado sem NUNCA
  rodar um comando nem escrever um arquivo — diagnóstico `(nenhum terminal
  rodado)`.

  O que estes testes afirmam não é a busca, que já funcionava: é que as duas
  situações — "procurei e não achei" e "não há o que procurar" — deixaram de
  dizer a mesma coisa.
  """

  # async: false — o describe "teto de resultados" muta Application.env
  # GLOBAL (:search_workspace_max_hits, :search_workspace_max_bytes), mesmo
  # padrão de Engine.Harness.Tools.ReadFileTest e
  # Engine.Actions.TerminalExecutorTest para seus próprios tetos.
  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.SearchWorkspace

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-search-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf!(root) end)

    %{root: root, ctx: %{workspace_root: root, project_id: "proj-1"}}
  end

  test "workspace VAZIO diz que está vazio, e manda criar", %{ctx: ctx} do
    assert {:ok, texto} = SearchWorkspace.run(%{"query" => "saudacao"}, ctx)

    assert texto =~ "VAZIO"
    # A instrução é o que quebra o laço: sem ela o agente continua buscando.
    assert texto =~ "CRIE"
    assert texto =~ "write_file"
  end

  test "workspace COM arquivos e sem casar diz que a busca funcionou", %{
    root: root,
    ctx: ctx
  } do
    File.write!(Path.join(root, "app.ts"), "export const x = 1;")
    File.write!(Path.join(root, "README.md"), "projeto")

    assert {:ok, texto} = SearchWorkspace.run(%{"query" => "saudacao"}, ctx)

    refute texto =~ "VAZIO"
    # O número é o que distingue: diz ao agente que há material, e que o termo
    # é que não aparece.
    assert texto =~ "2 arquivo(s)"
    assert texto =~ "saudacao"
  end

  test "só o template do Gitflow NÃO conta como vazio", %{root: root, ctx: ctx} do
    # O caso EXATO do achado X: o repositório tinha `.github/` e `docs/` do
    # bootstrap, e nenhum código. Não é vazio — e a mensagem certa é a de
    # "busca funcionou", não a de "crie os arquivos".
    File.mkdir_p!(Path.join(root, ".github"))
    File.write!(Path.join(root, ".github/pull_request_template.md"), "## O quê")
    File.mkdir_p!(Path.join(root, "docs"))
    File.write!(Path.join(root, "docs/branching-policy.md"), "dev, qa, main")

    assert {:ok, texto} = SearchWorkspace.run(%{"query" => "saudacao"}, ctx)

    refute texto =~ "VAZIO"
    assert texto =~ "2 arquivo(s)"
  end

  test "achou continua respondendo o que achou", %{root: root, ctx: ctx} do
    File.write!(Path.join(root, "saudacao.ts"), "export const oi = 1;")

    assert {:ok, texto} = SearchWorkspace.run(%{"query" => "saudacao"}, ctx)

    assert texto =~ "1 resultado(s)"
    assert texto =~ "saudacao.ts"
  end

  test "sem query continua sendo erro de argumento", %{ctx: ctx} do
    assert {:error, motivo} = SearchWorkspace.run(%{}, ctx)
    assert motivo =~ "query"
  end

  # Os dois tetos independentes (achado da revisão de PR #272 em diante): a
  # busca com muitos resultados estourava {413, "request entity too large"}
  # do provider do mesmo jeito que terminal e read_file, só que pela porta da
  # QUANTIDADE de hits em vez do tamanho de um arquivo só.
  describe "teto de resultados" do
    setup do
      on_exit(fn ->
        Application.delete_env(:engine, :search_workspace_max_hits)
        Application.delete_env(:engine, :search_workspace_max_bytes)
      end)

      :ok
    end

    test "busca com poucos resultados não é alterada", %{root: root, ctx: ctx} do
      Application.put_env(:engine, :search_workspace_max_hits, 500)

      File.write!(Path.join(root, "alvo1.ts"), "x")
      File.write!(Path.join(root, "alvo2.ts"), "x")

      assert {:ok, texto} = SearchWorkspace.run(%{"query" => "alvo"}, ctx)

      assert texto =~ "2 resultado(s):"
      refute texto =~ "truncad"
    end

    test "busca com mais resultados que o teto é truncada com aviso claro", %{
      root: root,
      ctx: ctx
    } do
      Application.put_env(:engine, :search_workspace_max_hits, 3)

      for i <- 1..10 do
        File.write!(Path.join(root, "alvo#{i}.ts"), "x")
      end

      assert {:ok, texto} = SearchWorkspace.run(%{"query" => "alvo"}, ctx)

      # Mostra só os 3 primeiros — o total exato NUNCA é fingido, porque foi
      # exatamente o custo de contá-lo que o teto evitou pagar.
      assert texto =~ "3 resultado(s):"
      assert texto =~ "busca truncada"
      assert texto =~ "3 primeiro(s) resultado(s)"
      assert texto =~ "pode haver mais"
      assert texto =~ "Refine a busca"
      refute texto =~ "alvo4.ts"
    end

    test "texto final maior que o teto de bytes também é cortado, mesmo com poucos hits", %{
      root: root,
      ctx: ctx
    } do
      Application.put_env(:engine, :search_workspace_max_bytes, 20)

      File.write!(Path.join(root, "alvo-com-um-nome-bem-comprido-de-verdade.ts"), "x")

      assert {:ok, texto} = SearchWorkspace.run(%{"query" => "alvo"}, ctx)

      assert byte_size(texto) < 200
      assert texto =~ "busca truncada"
      assert texto =~ "bytes"
    end
  end
end
