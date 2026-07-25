defmodule Engine.Harness.WriteFilePolicyTest do
  # async: false — mexe em Application env global (:write_file_whitelist,
  # :write_file_agent_prefixes) e no filesystem.
  use ExUnit.Case, async: false

  alias Engine.Harness.{WorkspaceFiles, WriteFilePolicy}

  setup do
    on_exit(fn ->
      Application.delete_env(:engine, :write_file_whitelist)
      Application.delete_env(:engine, :write_file_agent_prefixes)
    end)

    :ok
  end

  describe "allowed?/2" do
    test "dev agent escreve em qualquer path da própria raiz" do
      # É o destravamento da Fase 4a: sem isto todo write_file do dev vira
      # proposed_action pendente (e write_file não tem executor na api), então
      # ele nunca chega numa suite verde e a task sempre bloqueia.
      assert WriteFilePolicy.allowed?("dev-api", "src/cadastro.ts")
      assert WriteFilePolicy.allowed?("dev-api", "test/cadastro.spec.ts")
      assert WriteFilePolicy.allowed?("dev-web", "package.json")
      # O subagente da paralelização tem o mesmo direito.
      assert WriteFilePolicy.allowed?("dev-api-2", "src/x.ts")
    end

    test "agente fora do prefixo continua caindo no pipeline de aprovação" do
      refute WriteFilePolicy.allowed?("qa", "src/x.ts")
      refute WriteFilePolicy.allowed?("secops", "src/x.ts")
      refute WriteFilePolicy.allowed?("arquiteto", "docs/adr/0001.md")
      refute WriteFilePolicy.allowed?("criativo", "qualquer.md")
    end

    test "whitelist por path exata do EchoAgent segue valendo" do
      assert WriteFilePolicy.allowed?("echo", "scratch/nota.md")
      refute WriteFilePolicy.allowed?("echo", "src/producao.ts")
    end

    test "prefixos são configuráveis" do
      Application.put_env(:engine, :write_file_agent_prefixes, ["qa-"])

      assert WriteFilePolicy.allowed?("qa-api", "x.ts")
      refute WriteFilePolicy.allowed?("dev-api", "x.ts")
    end
  end

  describe "fronteira real de escrita" do
    setup do
      root =
        Path.join(
          System.tmp_dir!(),
          "brabo-wfp-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
        )

      File.mkdir_p!(root)
      on_exit(fn -> File.rm_rf!(root) end)
      %{root: root}
    end

    test "o sandbox do dev é a raiz, não a whitelist: travessia é barrada", %{root: root} do
      # A política libera o path pro dev...
      assert WriteFilePolicy.allowed?("dev-api", "../fora.txt")

      # ...mas quem de fato segura a fronteira é o WorkspaceFiles, que resolve
      # o caminho e recusa qualquer coisa fora da raiz (o worktree do agente).
      assert {:error, :traversal} = WorkspaceFiles.write_file(root, "../fora.txt", "x")
      assert {:error, :traversal} = WorkspaceFiles.write_file(root, "/etc/passwd", "x")

      refute File.exists?(Path.join(Path.dirname(root), "fora.txt"))
    end

    test "escrita dentro da raiz funciona", %{root: root} do
      assert {:ok, _} = WorkspaceFiles.write_file(root, "src/novo.ts", "conteudo")
      assert File.read!(Path.join(root, "src/novo.ts")) == "conteudo"
    end
  end
end
