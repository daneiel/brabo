defmodule Engine.Gates.RelatorioJunitTest do
  # AT-687 (RN-996): o engine lê o JUnit; falha vira campo nomeado.
  use ExUnit.Case, async: true

  alias Engine.Gates.RelatorioJunit

  @vitest """
  <?xml version="1.0" encoding="UTF-8" ?>
  <testsuites name="vitest tests" tests="3" failures="1" time="0.5">
    <testsuite name="a.test.ts" tests="3">
      <testcase classname="a.test.ts" name="soma" time="0.010"></testcase>
      <testcase classname="a.test.ts" name="quebra" time="0.200"><failure message="esperado 1">stack</failure></testcase>
      <testcase classname="a.test.ts" name="depois" time="0"><skipped/></testcase>
    </testsuite>
  </testsuites>
  """

  test "vitest: contadores, falha primeiro e mensagem" do
    assert {:ok, r} = RelatorioJunit.parse(@vitest)
    assert %{fonte: "junit", total: 3, passaram: 1, falharam: 1, pulados: 1, duracaoMs: 210} = r
    assert r.casosOmitidos == 0
    [%{nome: "a.test.ts", casos: [primeiro | _]}] = r.suites
    assert %{status: "falhou", mensagem: "esperado 1"} = primeiro
  end

  test "pytest: error com texto no corpo" do
    xml = """
    <testsuites><testsuite name="pytest"><testcase classname="t" name="x" time="0.1"><error>boom</error></testcase></testsuite></testsuites>
    """

    assert {:ok, %{falharam: 1, suites: [%{casos: [%{mensagem: "boom"}]}]}} =
             RelatorioJunit.parse(xml)
  end

  test "XXE: DOCTYPE/ENTITY é recusado antes do parser" do
    xml = """
    <?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>
    <testsuite name="s"><testcase name="&e;"/></testsuite>
    """

    assert {:error, :doctype_recusado} = RelatorioJunit.parse(xml)
  end

  test "teto de tamanho e de gravação (200 casos, contadores do relatório inteiro)" do
    assert {:error, :acima_do_teto} = RelatorioJunit.parse(String.duplicate("a", 2_097_153))

    casos = for i <- 1..250, into: "", do: ~s(<testcase name="t#{i}" time="0.001"/>)
    assert {:ok, r} = RelatorioJunit.parse(~s(<testsuite name="s">#{casos}</testsuite>))
    assert r.total == 250 and r.casosOmitidos == 50
    assert r.suites |> Enum.flat_map(& &1.casos) |> length() == 200
  end

  test "teto de casos lidos" do
    casos = String.duplicate(~s(<testcase name="t"/>), 20_001)

    assert {:error, :casos_demais} =
             RelatorioJunit.parse(~s(<testsuite name="s">#{casos}</testsuite>))
  end

  test "XML inválido e sem casos viram erro, nunca lançam" do
    assert {:error, _} = RelatorioJunit.parse("<testsuite><oops>")
    assert {:error, :sem_casos} = RelatorioJunit.parse("<testsuites/>")
  end

  test "ler/1: sem caminho, ausente, inválido e ok (arquivo apagado)" do
    raiz = Path.join(System.tmp_dir!(), "junit-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(raiz, ".brabo-qa"))
    on_exit(fn -> File.rm_rf!(raiz) end)
    ctx = fn rel -> %{args: %{"relatorioDeTestes" => rel}, workspace_root: raiz} end

    assert %{indisponivel: "sem_relatorio", origem: "modelo"} = RelatorioJunit.ler(%{args: %{}})
    assert %{indisponivel: "sem_relatorio"} = RelatorioJunit.ler(ctx.(".brabo-qa/nao.xml"))
    assert %{indisponivel: "relatorio_invalido"} = RelatorioJunit.ler(ctx.("../fora.xml"))

    arq = Path.join(raiz, ".brabo-qa/junit.xml")
    File.write!(arq, "<lixo")

    assert %{indisponivel: "relatorio_invalido", origem: "codigo"} =
             RelatorioJunit.ler(ctx.(".brabo-qa/junit.xml"))

    File.write!(arq, @vitest)
    assert %{fonte: "junit", total: 3} = RelatorioJunit.ler(ctx.(".brabo-qa/junit.xml"))
    refute File.exists?(arq)
  end
end
