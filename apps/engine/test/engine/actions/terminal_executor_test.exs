defmodule Engine.Actions.TerminalExecutorTest do
  # async: false — os testes mutam Application.env global (project_workspaces_root,
  # rtk_detector/rtk_fake_*), então precisam serializar entre si dentro
  # deste módulo (mesmo motivo documentado em session_lifecycle_test.exs).
  use Engine.DataCase, async: false

  alias Engine.Actions.TerminalExecutor

  setup do
    root =
      Path.join(System.tmp_dir!(), "brabo-executor-test-#{System.unique_integer([:positive])}")

    File.mkdir_p!(root)
    Application.put_env(:engine, :project_workspaces_root, root)

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :rtk_detector)
      Application.delete_env(:engine, :rtk_fake_available)
      Application.delete_env(:engine, :rtk_fake_gain_ratio)
    end)

    :ok
  end

  # System.unique_integer/1 reinicia a cada VM (cada `mix test`) — rodar a
  # suite muitas vezes em sequência rápida colide em paths de /tmp de
  # execuções anteriores (causou flakiness real: git init num diretório
  # de uma execução anterior, em estado inesperado). os_time garante
  # unicidade entre processos de VM diferentes.
  defp unique_tmp_name(prefix) do
    "#{prefix}-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
  end

  defp create_bare_repo_with_commit! do
    bare_dir = Path.join(System.tmp_dir!(), unique_tmp_name("brabo-bare") <> ".git")
    on_exit(fn -> File.rm_rf!(bare_dir) end)

    {_, 0} = System.cmd("git", ["init", "--bare", bare_dir])

    clone_dir = Path.join(System.tmp_dir!(), unique_tmp_name("brabo-clone"))
    {_, 0} = System.cmd("git", ["clone", bare_dir, clone_dir])
    File.write!(Path.join(clone_dir, "README.md"), "oi")
    {_, 0} = System.cmd("git", ["add", "."], cd: clone_dir)

    {_, 0} =
      System.cmd(
        "git",
        ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-m", "init"],
        cd: clone_dir
      )

    {_, 0} = System.cmd("git", ["push", "origin", "HEAD:main"], cd: clone_dir)
    File.rm_rf!(clone_dir)
    bare_dir
  end

  defp insert_project_repository!(project_id, provider \\ "local", external_id) do
    Repo.query!(
      """
      INSERT INTO public.project_repositories
        (id, project_id, provider, external_id, url, default_branch, visibility, provisioned_by)
      VALUES ($1, $2, $3, $4, $5, 'main', 'private', $6)
      """,
      [
        Ecto.UUID.dump!(Ecto.UUID.generate()),
        Ecto.UUID.dump!(project_id),
        provider,
        external_id,
        "file://#{external_id}",
        Ecto.UUID.dump!(Ecto.UUID.generate())
      ]
    )
  end

  defp unique_project_id, do: Ecto.UUID.generate()

  # Este ambiente de dev pode ter um `rtk` real no PATH (ferramenta
  # pessoal do usuário, sem relação com o repo) — nunca confiar na
  # ausência ambiente de System.find_executable/1; força via Fake pra
  # qualquer teste que precise de "rtk indisponível" de verdade.
  defp force_rtk_unavailable! do
    Application.put_env(:engine, :rtk_detector, Engine.Actions.RtkDetector.Fake)
    Application.put_env(:engine, :rtk_fake_available, false)
  end

  test "caminho feliz: executa o comando real no working tree e captura o output" do
    force_rtk_unavailable!()
    bare = create_bare_repo_with_commit!()
    project_id = unique_project_id()
    insert_project_repository!(project_id, bare)

    result = TerminalExecutor.run(project_id, "echo oi")

    assert result.exit_code == 0
    assert result.stdout =~ "oi"
    assert result.timed_out == false
    assert result.raw_bytes > 0
    assert result.estimated_tokens_raw > 0
    assert result.compressed_bytes == nil
    assert result.estimated_tokens_compressed == nil
  end

  test "roda dentro do working tree de verdade (arquivo do checkout está lá)" do
    bare = create_bare_repo_with_commit!()
    project_id = unique_project_id()
    insert_project_repository!(project_id, bare)

    result = TerminalExecutor.run(project_id, "cat README.md")

    assert result.stdout =~ "oi"
  end

  test "timeout: comando mais lento que o configurado é marcado timed_out, sem exit_code" do
    bare = create_bare_repo_with_commit!()
    project_id = unique_project_id()
    insert_project_repository!(project_id, bare)

    result = TerminalExecutor.run(project_id, "sleep 5", timeout_ms: 100)

    assert result.timed_out == true
    assert result.exit_code == nil
  end

  test "rtk indisponível (forçado via fake): campos de compressão ficam nulos" do
    force_rtk_unavailable!()
    bare = create_bare_repo_with_commit!()
    project_id = unique_project_id()
    insert_project_repository!(project_id, bare)

    result = TerminalExecutor.run(project_id, "echo oi")

    assert result.compressed_bytes == nil
    assert result.estimated_tokens_compressed == nil
  end

  test "rtk 'disponível' (fake): estima bytes/tokens comprimidos a partir da razão" do
    Application.put_env(:engine, :rtk_detector, Engine.Actions.RtkDetector.Fake)
    Application.put_env(:engine, :rtk_fake_available, true)
    Application.put_env(:engine, :rtk_fake_gain_ratio, 0.5)

    bare = create_bare_repo_with_commit!()
    project_id = unique_project_id()
    insert_project_repository!(project_id, bare)

    result = TerminalExecutor.run(project_id, "echo oi")

    assert result.compressed_bytes == round(result.raw_bytes * 0.5)
    assert result.estimated_tokens_compressed > 0
  end

  # ADR 0056. Este teste afirmava `unsupported_provider` — o comportamento que a
  # Fase B existe para REMOVER: era ele que fazia todo comando falhar em projeto
  # do GitHub. Agora o provider remoto resolve pela api, e o que se afirma é o
  # caminho de FALHA dela, que é o novo modo de erro possível.
  test "provider remoto: falha nomeia que o remoto não veio, não o provider" do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :fake_git_remote, %{origin: nil})

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :fake_git_remote)
    end)

    project_id = unique_project_id()
    insert_project_repository!(project_id, "github", "org/repo")

    result = TerminalExecutor.run(project_id, "echo oi")

    assert result.exit_code == nil
    assert result.stdout == ""
    # O diagnóstico diz o que faltou — remoto —, e não "provider não suportado",
    # que mandava procurar no lugar errado.
    assert result.stderr =~ "remoto_indisponivel"
    refute result.stderr =~ "unsupported_provider"
  end

  test "projeto nunca provisionado: falha claramente, sem executar nada" do
    result = TerminalExecutor.run(unique_project_id(), "echo oi")

    assert result.exit_code == nil
    assert result.stderr =~ "not_found"
  end

  # O teto de bytes da saída (achado S).
  #
  # A regressão que isto pega custou uma execução real inteira: sem teto, a
  # saída de cada comando ficava no histórico do laço e viajava em TODO turno
  # seguinte, até o provider recusar a requisição com
  # `{413, "request entity too large"}` no turno 18 — antes de o agente
  # escrever uma linha de código.
  describe "teto de bytes da saída" do
    setup do
      on_exit(fn -> Application.delete_env(:engine, :terminal_output_max_bytes) end)
      :ok
    end

    test "saída menor que o teto passa intacta, sem marca" do
      Application.put_env(:engine, :terminal_output_max_bytes, 1_000)

      assert TerminalExecutor.truncate("oi\n", 3) == "oi\n"
    end

    test "saída no limite exato NÃO é truncada" do
      # `>` e não `>=`: cortar no limite exato marcaria como truncada uma saída
      # que coube inteira, e o modelo tentaria refinar um comando que já deu
      # tudo o que tinha.
      Application.put_env(:engine, :terminal_output_max_bytes, 4)

      assert TerminalExecutor.truncate("abcd", 4) == "abcd"
    end

    test "saída maior que o teto é cortada e a marca diz os dois tamanhos" do
      Application.put_env(:engine, :terminal_output_max_bytes, 10)
      saida = String.duplicate("x", 100)

      resultado = TerminalExecutor.truncate(saida, 100)

      assert String.starts_with?(resultado, String.duplicate("x", 10))
      assert resultado =~ "saída truncada: 10 de 100 bytes"
      # A marca diz o que FAZER — sem isso o modelo repete o mesmo comando.
      assert resultado =~ "Refine o comando"
    end

    test "corte não parte caractere multibyte ao meio" do
      # `binary_part/3` corta por byte. "é" ocupa 2 bytes; um teto ímpar cai
      # no meio dele e produziria binário inválido, que quebra a serialização
      # JSON do resultado antes de chegar ao modelo.
      Application.put_env(:engine, :terminal_output_max_bytes, 3)
      saida = "aéé"

      resultado = TerminalExecutor.truncate(saida, byte_size(saida))

      assert String.valid?(resultado)
      assert String.starts_with?(resultado, "aé")
    end

    test "o resultado do comando real carrega a saída truncada, e raw_bytes o tamanho REAL" do
      Application.put_env(:engine, :terminal_output_max_bytes, 50)
      force_rtk_unavailable!()
      bare = create_bare_repo_with_commit!()
      project_id = unique_project_id()
      insert_project_repository!(project_id, bare)

      # 2000 bytes de saída, muito acima do teto de 50.
      result = TerminalExecutor.run(project_id, "printf 'x%.0s' $(seq 1 2000)")

      assert result.exit_code == 0
      assert result.stdout =~ "saída truncada"
      assert byte_size(result.stdout) < 200
      # Medição não mente: raw_bytes é o que o comando PRODUZIU, não o que
      # sobrou depois do corte.
      assert result.raw_bytes == 2000
    end
  end
end
