defmodule Engine.Gates.ConferenciaDoReadmeTest do
  @moduledoc "RN-798 (AT-475): o README tocado pela entrega é conferido contra os scripts."

  use ExUnit.Case, async: true

  alias Engine.Gates.ConferenciaDoReadme

  setup do
    dir = Path.join(System.tmp_dir!(), "brabo-readme-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)

    File.write!(
      Path.join(dir, "package.json"),
      Jason.encode!(%{"scripts" => %{"dev" => "vite", "test" => "vitest"}})
    )

    %{dir: dir}
  end

  test "caminho feliz: comandos que batem com os scripts não divergem", %{dir: dir} do
    File.write!(Path.join(dir, "README.md"), "Rode `pnpm install`, `npm run dev` e `npm test`.\n")
    assert ConferenciaDoReadme.conferir(dir, {:ok, ["README.md"]}) == []
  end

  test "falha: script citado que não existe vira divergência nomeada", %{dir: dir} do
    File.write!(Path.join(dir, "README.md"), "Rode `pnpm build` e `yarn run lint`.\n")

    assert [a, b] = ConferenciaDoReadme.conferir(dir, {:ok, ["README.md"]})
    assert a =~ "`pnpm build`"
    assert a =~ "script `build`"
    assert b =~ "script `lint`"
  end

  test "sem README no diff, ou diff que falhou: não afirma nada", %{dir: dir} do
    assert ConferenciaDoReadme.conferir(dir, {:ok, ["src/a.ts"]}) == nil
    assert ConferenciaDoReadme.conferir(dir, {:error, :x}) == nil
  end

  test "flag antes do script fica de fora, declarado" do
    assert ConferenciaDoReadme.divergencias_do_texto("README.md", "pnpm --filter api x", %{}) ==
             []
  end
end
