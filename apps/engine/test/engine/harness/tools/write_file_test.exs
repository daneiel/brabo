defmodule Engine.Harness.Tools.WriteFileTest do
  # RN-900 (AT-571): write_file substitui o arquivo inteiro; README que tem a
  # seção de uso da Infra não pode perdê-la numa reescrita parcial.
  use ExUnit.Case, async: true

  alias Engine.Harness.Tools.WriteFile

  @secao WriteFile.titulo_secao_de_uso()

  setup do
    dir =
      Path.join(
        System.tmp_dir!(),
        "brabo-wf-test-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    %{ctx: %{workspace_root: dir, project_id: "p"}, dir: dir}
  end

  test "caminho feliz: README com a seção reescrito completo com a seção passa", %{
    ctx: ctx,
    dir: dir
  } do
    File.write!(Path.join(dir, "README.md"), "# App\n\n## #{@secao}\n\nvelho\n")
    novo = "# App\n\n## #{@secao}\n\nnovo\n"
    assert {:ok, _} = WriteFile.run(%{"path" => "README.md", "content" => novo}, ctx)
    assert File.read!(Path.join(dir, "README.md")) == novo
  end

  test "caminho feliz: arquivo que não é README passa mesmo com a seção no conteúdo antigo", %{
    ctx: ctx,
    dir: dir
  } do
    File.write!(Path.join(dir, "notas.md"), "## #{@secao}\n")
    assert {:ok, _} = WriteFile.run(%{"path" => "notas.md", "content" => "outro"}, ctx)
    assert File.read!(Path.join(dir, "notas.md")) == "outro"
  end

  test "falha: reescrever o README sem a seção é recusado e o arquivo fica intacto", %{
    ctx: ctx,
    dir: dir
  } do
    original = "# App\n\n## #{@secao}\n\ncomando\n"
    File.write!(Path.join(dir, "README.md"), original)

    assert {:error, msg} =
             WriteFile.run(%{"path" => "README.md", "content" => "# App\n\nsó o trecho\n"}, ctx)

    assert msg =~ @secao
    assert msg =~ "substitui o arquivo inteiro"
    assert File.read!(Path.join(dir, "README.md")) == original
  end
end
