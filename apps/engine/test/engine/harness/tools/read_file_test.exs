defmodule Engine.Harness.Tools.ReadFileTest do
  # async: false — o teto de bytes muta Application.env GLOBAL
  # (:read_file_max_bytes), mesmo padrão de
  # Engine.Actions.TerminalExecutorTest para :terminal_output_max_bytes.
  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.ReadFile
  alias Engine.Actions.Workspace

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-rf-test-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    project_id = "proj-#{System.unique_integer([:positive])}"
    File.mkdir_p!(Workspace.workspace_dir(project_id))
    on_exit(fn -> File.rm_rf!(root) end)
    %{ctx: %{project_id: project_id}, dir: Workspace.workspace_dir(project_id)}
  end

  test "lê arquivo dentro do workspace", %{ctx: ctx, dir: dir} do
    File.write!(Path.join(dir, "a.txt"), "conteúdo")
    assert {:ok, "conteúdo"} = ReadFile.run(%{"path" => "a.txt"}, ctx)
  end

  test "path traversal é bloqueado", %{ctx: ctx} do
    assert {:error, msg} = ReadFile.run(%{"path" => "../../etc/passwd"}, ctx)
    assert msg =~ "fora do workspace"
  end

  test "arquivo inexistente vira erro com o motivo", %{ctx: ctx} do
    assert {:error, msg} = ReadFile.run(%{"path" => "nao-existe.txt"}, ctx)
    assert msg =~ "falha ao ler nao-existe.txt"
  end

  test "sem `path` nos argumentos, recusa dizendo o que falta", %{ctx: ctx} do
    assert {:error, msg} = ReadFile.run(%{}, ctx)
    assert msg =~ "exige o argumento `path`"
  end

  # O teto de bytes do conteúdo lido (mesma classe do achado S, pela porta do
  # read_file em vez do terminal). Sem teto, ler um lockfile/bundle grande
  # basta pra estourar {413, "request entity too large"} no turno seguinte —
  # o QA de Performance/Segurança sente isso especialmente forte, porque só
  # tem ReadFile/SearchWorkspace (sem Terminal) pra investigar uma PR.
  describe "teto de bytes do conteúdo" do
    setup do
      on_exit(fn -> Application.delete_env(:engine, :read_file_max_bytes) end)
      :ok
    end

    test "conteúdo menor que o teto passa intacto, sem marca" do
      Application.put_env(:engine, :read_file_max_bytes, 1_000)

      assert ReadFile.truncate("oi\n", "a.txt") == "oi\n"
    end

    test "conteúdo no limite exato NÃO é truncado" do
      Application.put_env(:engine, :read_file_max_bytes, 4)

      assert ReadFile.truncate("abcd", "a.txt") == "abcd"
    end

    test "conteúdo maior que o teto é cortado e a marca diz o arquivo e os dois tamanhos" do
      Application.put_env(:engine, :read_file_max_bytes, 10)
      conteudo = String.duplicate("x", 100)

      resultado = ReadFile.truncate(conteudo, "lockfile.json")

      assert String.starts_with?(resultado, String.duplicate("x", 10))
      assert resultado =~ "arquivo lockfile.json truncado"
      assert resultado =~ "mostrando 10 de 100 bytes"
    end

    test "corte não parte caractere multibyte ao meio" do
      Application.put_env(:engine, :read_file_max_bytes, 3)
      conteudo = "aéé"

      resultado = ReadFile.truncate(conteudo, "a.txt")

      assert String.valid?(resultado)
      assert String.starts_with?(resultado, "aé")
    end

    test "run/2 devolve o conteúdo truncado quando o arquivo excede o teto", %{
      ctx: ctx,
      dir: dir
    } do
      Application.put_env(:engine, :read_file_max_bytes, 20)
      File.write!(Path.join(dir, "grande.txt"), String.duplicate("y", 200))

      assert {:ok, texto} = ReadFile.run(%{"path" => "grande.txt"}, ctx)
      assert byte_size(texto) < 200
      assert texto =~ "arquivo grande.txt truncado"
    end
  end
end
