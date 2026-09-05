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

  # Roteamento pro runner local (execution_mode "runner", workspace
  # VERIFICADO e runner conectado — RN-423, ADR 0104. Ver o moduledoc do
  # módulo). O comando já chega aqui APROVADO; este módulo só decide ONDE
  # rodar.
  describe "roteamento pro runner local" do
    setup do
      on_exit(fn -> Application.delete_env(:engine, :engine_api_client) end)
      :ok
    end

    defp insert_runner_project!(project_id, workspace_path, opts \\ []) do
      verificado_em = if Keyword.get(opts, :verified, true), do: "now()", else: "NULL"

      Repo.query!(
        "INSERT INTO public.projects " <>
          "(id, name, slug, execution_mode, workspace_path, workspace_verified_at) " <>
          "VALUES ($1, 'proj', 'proj', 'runner', $2, #{verificado_em})",
        [Ecto.UUID.dump!(project_id), workspace_path]
      )
    end

    # Modo `mounted` (ADR 0072/0104): segue o MESMO ramo de `container` desde a
    # RN-502/ADR 0143 — com container REGISTRADO `running`,
    # `:executar_no_container`; sem ele, `:recusar_container_ausente`. Nunca
    # `:caminho_de_sempre`, que era o comportamento até esta entrega.
    #
    # O que CONTINUA valendo: `mounted` nunca checa runner conectado, porque
    # não HÁ roteamento pro runner nesse modo — a checagem de `Registry` é
    # exclusiva do modo `runner`.
    defp insert_mounted_project!(project_id, workspace_path) do
      Repo.query!(
        "INSERT INTO public.projects (id, name, slug, execution_mode, workspace_path) " <>
          "VALUES ($1, 'proj', 'proj', 'mounted', $2)",
        [Ecto.UUID.dump!(project_id), workspace_path]
      )
    end

    # Spawna um processo que age como o runner: registra a presença e
    # responde ao "exec" recebido com um exec_result fixo. Roda num processo
    # PRÓPRIO (não no processo de teste) porque `TerminalExecutor.run/3`
    # bloqueia em `receive` esperando a resposta — o mesmo processo não pode
    # esperar por si mesmo.
    defp start_fake_runner!(project_id, responder) do
      parent = self()

      pid =
        spawn(fn ->
          Ecto.Adapters.SQL.Sandbox.allow(Engine.Repo, parent, self())
          :ok = Engine.Runners.Registry.register(project_id, self())
          send(parent, :fake_runner_ready)

          receive do
            {:dispatch_exec, ref, command, cwd, from, _timeout_ms} ->
              send(from, {:runner_exec_result, ref, responder.(command, cwd)})
          end
        end)

      assert_receive :fake_runner_ready, 1_000
      on_exit(fn -> Process.exit(pid, :kill) end)
      pid
    end

    test "com workspace VERIFICADO e runner conectado, o comando é roteado pro canal" do
      project_id = unique_project_id()
      insert_runner_project!(project_id, "/pasta/do/usuario", verified: true)

      start_fake_runner!(project_id, fn command, cwd ->
        %{
          "ref" => "qualquer",
          "exitCode" => 0,
          "output" => "rodei #{command} em #{cwd}",
          "timedOut" => false
        }
      end)

      result = TerminalExecutor.run(project_id, "echo oi")

      assert result.exit_code == 0
      assert result.stdout == "rodei echo oi em /pasta/do/usuario"
      assert result.timed_out == false
    end

    test "cwd explícito (worktree) é repassado ao runner tal como veio" do
      project_id = unique_project_id()
      insert_runner_project!(project_id, "/pasta/do/usuario", verified: true)

      start_fake_runner!(project_id, fn command, cwd ->
        %{"ref" => "x", "exitCode" => 0, "output" => "#{command}|#{cwd}", "timedOut" => false}
      end)

      result = TerminalExecutor.run(project_id, "pwd", cwd: "/pasta/do/usuario/worktree-x")

      assert result.stdout == "pwd|/pasta/do/usuario/worktree-x"
    end

    # RN-423 (ADR 0104): projeto `runner` cujo workspace NUNCA foi
    # confirmado recusa explicitamente — nunca roteia (nem HÁ runner
    # conectado aqui) e nunca cai no `System.cmd`, que rodaria numa pasta
    # que o processo do engine não enxerga.
    test "runner NÃO verificado: recusa explicitamente, sem executar nada" do
      project_id = unique_project_id()
      insert_runner_project!(project_id, "/pasta/do/usuario", verified: false)

      result = TerminalExecutor.run(project_id, "echo oi")

      assert result.exit_code == nil
      assert result.stdout == ""
      assert result.stderr =~ "ainda não teve o workspace confirmado"
      assert result.stderr =~ "brabo-runner"
    end

    # RN-423: workspace JÁ verificado, mas nenhum runner está conectado
    # AGORA — recusa do mesmo jeito, nunca cai no `System.cmd` (que não
    # tem pra onde rodar: um projeto `runner` não tem bind-mount).
    test "runner verificado mas SEM runner conectado: recusa explicitamente, sem cair no caminho de sempre" do
      project_id = unique_project_id()
      insert_runner_project!(project_id, "/pasta/do/usuario", verified: true)

      refute Engine.Runners.Registry.connected?(project_id)

      result = TerminalExecutor.run(project_id, "echo oi")

      assert result.exit_code == nil
      assert result.stdout == ""
      assert result.stderr =~ "nenhum runner está conectado"
    end

    # RN-502/ADR 0143 — este teste afirmava o contrário até aqui ("cai no
    # caminho de sempre"), e era essa a degradação calada: projeto `mounted`
    # sem container executava `System.cmd` DENTRO do processo do engine, e
    # nada na saída dizia isso. `mounted` entrou no mesmo ramo de `container`.
    test "SEM runner nenhum envolvido, projeto mounted SEM container running RECUSA" do
      force_rtk_unavailable!()
      bare = create_bare_repo_with_commit!()
      project_id = unique_project_id()
      insert_project_repository!(project_id, bare)

      workspace_path =
        Path.join(System.tmp_dir!(), "brabo-mounted-ws-#{System.unique_integer([:positive])}")

      on_exit(fn -> File.rm_rf!(workspace_path) end)
      insert_mounted_project!(project_id, workspace_path)

      result = TerminalExecutor.run(project_id, "echo oi")

      assert result.exit_code == nil
      assert result.stdout == ""
      assert result.stderr =~ "não tem container REGISTRADO como `running`"
    end

    test "projeto em modo container (default) nunca roteia pro runner, mesmo se um estivesse conectado" do
      force_rtk_unavailable!()
      bare = create_bare_repo_with_commit!()
      project_id = unique_project_id()
      insert_project_repository!(project_id, bare)
      # execution_mode nulo == "container" (comportamento de sempre).

      test_pid = self()

      start_fake_runner!(project_id, fn command, cwd ->
        send(test_pid, {:runner_foi_chamado, command, cwd})

        %{
          "ref" => "x",
          "exitCode" => 0,
          "output" => "não deveria chegar aqui",
          "timedOut" => false
        }
      end)

      result = TerminalExecutor.run(project_id, "echo oi")

      assert result.exit_code == 0
      assert result.stdout =~ "oi"
      refute_receive {:runner_foi_chamado, _, _}, 200
    end
  end

  # Execução DENTRO do container real do projeto (ADR 0134, RN-492). Ver o
  # moduledoc do módulo pra o raciocínio completo — aqui só a quinta saída
  # de `decisao_de_execucao/1` e o mapeamento do resultado do broker.
  describe "execução dentro do container real do projeto" do
    setup do
      Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
      Application.put_env(:engine, :test_pid, self())

      on_exit(fn ->
        Application.delete_env(:engine, :engine_api_client)
        Application.delete_env(:engine, :test_pid)
        Process.delete(:fake_container_exec)
      end)

      :ok
    end

    defp insert_container_project!(project_id, workspace_dir_name) do
      Repo.query!(
        "INSERT INTO public.projects " <>
          "(id, name, slug, execution_mode, workspace_dir_name) " <>
          "VALUES ($1, 'proj', 'proj', 'container', $2)",
        [Ecto.UUID.dump!(project_id), workspace_dir_name]
      )
    end

    defp insert_container_lifecycle!(project_id, status) do
      Repo.query!(
        "INSERT INTO public.project_containers " <>
          "(id, project_id, status, image_version, cpus, memory_mb, pids_limit) " <>
          "VALUES ($1, $2, #{status}, 1, 1.0, 512, 128)",
        [Ecto.UUID.dump!(Ecto.UUID.generate()), Ecto.UUID.dump!(project_id)]
      )
    end

    test "container running: comando atravessa pro broker, sem tocar System.cmd" do
      project_id = unique_project_id()
      dir_name = unique_tmp_name("ws")
      insert_container_project!(project_id, dir_name)
      insert_container_lifecycle!(project_id, "'running'")

      Process.put(
        :fake_container_exec,
        {:ok,
         %{
           "sucesso" => true,
           "exitCode" => 0,
           "output" => "ok do container\n",
           "timedOut" => false
         }}
      )

      result = TerminalExecutor.run(project_id, "npm test")

      assert result.exit_code == 0
      assert result.stdout == "ok do container\n"
      assert_receive {:container_exec, ^project_id, "npm test", nil, _timeout}
    end

    test "cwd na raiz do workspace é traduzido para /work" do
      project_id = unique_project_id()
      dir_name = unique_tmp_name("ws")
      insert_container_project!(project_id, dir_name)
      insert_container_lifecycle!(project_id, "'running'")

      root = Application.fetch_env!(:engine, :project_workspaces_root)
      workspace_dir = Path.join(root, dir_name)

      Process.put(
        :fake_container_exec,
        {:ok, %{"sucesso" => true, "exitCode" => 0, "output" => "", "timedOut" => false}}
      )

      TerminalExecutor.run(project_id, "pwd", cwd: workspace_dir)

      assert_receive {:container_exec, ^project_id, "pwd", "/work", _timeout}
    end

    test "cwd de um worktree de dev agent é traduzido para dentro de /work, preservando o sufixo" do
      project_id = unique_project_id()
      dir_name = unique_tmp_name("ws")
      insert_container_project!(project_id, dir_name)
      insert_container_lifecycle!(project_id, "'running'")

      root = Application.fetch_env!(:engine, :project_workspaces_root)
      worktree = Path.join([root, dir_name, ".worktrees", "dev-api"])

      Process.put(
        :fake_container_exec,
        {:ok, %{"sucesso" => true, "exitCode" => 0, "output" => "", "timedOut" => false}}
      )

      TerminalExecutor.run(project_id, "pwd", cwd: worktree)

      assert_receive {:container_exec, ^project_id, "pwd", "/work/.worktrees/dev-api", _timeout}
    end

    test "broker recusou (sucesso: false): vira failed_result normal, nunca crash" do
      project_id = unique_project_id()
      dir_name = unique_tmp_name("ws")
      insert_container_project!(project_id, dir_name)
      insert_container_lifecycle!(project_id, "'running'")

      Process.put(
        :fake_container_exec,
        {:ok, %{"sucesso" => false, "motivo" => "container morreu por fora"}}
      )

      result = TerminalExecutor.run(project_id, "npm test")

      assert result.exit_code == nil
      assert result.stdout == ""
      assert result.stderr =~ "container morreu por fora"
    end

    test "falha de transporte engine->api: vira failed_result normal, nunca crash" do
      project_id = unique_project_id()
      dir_name = unique_tmp_name("ws")
      insert_container_project!(project_id, dir_name)
      insert_container_lifecycle!(project_id, "'running'")

      Process.put(:fake_container_exec, {:error, :timeout})

      result = TerminalExecutor.run(project_id, "npm test")

      assert result.exit_code == nil
      assert result.stdout == ""
      assert result.stderr =~ "não foi possível executar no container"
    end

    # RN-502/ADR 0143 — os dois testes abaixo afirmavam "cai no caminho de
    # sempre" e passaram a afirmar a recusa. É a mesma mudança vista de dois
    # ângulos: nunca ter subido e ter subido e caído.
    test "container SEM linha running (nunca subiu): RECUSA, e nunca chama o broker" do
      force_rtk_unavailable!()
      bare = create_bare_repo_with_commit!()
      project_id = unique_project_id()
      insert_project_repository!(project_id, bare)
      insert_container_project!(project_id, unique_tmp_name("ws"))
      # SEM insert_container_lifecycle! — nenhuma linha em project_containers.

      Process.put(
        :fake_container_exec,
        {:ok,
         %{
           "sucesso" => true,
           "exitCode" => 0,
           "output" => "não deveria chegar aqui",
           "timedOut" => false
         }}
      )

      result = TerminalExecutor.run(project_id, "echo oi")

      assert result.exit_code == nil
      assert result.stdout == ""
      assert result.stderr =~ "não tem container REGISTRADO como `running`"
      # Nem broker, nem `System.cmd`: sem container, não roda em lugar nenhum.
      refute_receive {:container_exec, _, _, _, _}, 200
    end

    test "container com linha 'stopped' (já subiu, mas não está de pé agora): RECUSA" do
      force_rtk_unavailable!()
      bare = create_bare_repo_with_commit!()
      project_id = unique_project_id()
      insert_project_repository!(project_id, bare)
      insert_container_project!(project_id, unique_tmp_name("ws"))
      insert_container_lifecycle!(project_id, "'stopped'")

      result = TerminalExecutor.run(project_id, "echo oi")

      assert result.exit_code == nil
      assert result.stdout == ""
      assert result.stderr =~ "não tem container REGISTRADO como `running`"
      refute_receive {:container_exec, _, _, _, _}, 200
    end

    # A outra metade da cláusula estendida: `mounted` COM container `running`
    # atravessa pro broker igual a `container` — desde que `mounted` passou a
    # subir container de verdade, tratá-lo diferente aqui seria arbitrário.
    test "mounted COM linha running atravessa pro broker, igual a container" do
      project_id = unique_project_id()

      workspace_path =
        Path.join(System.tmp_dir!(), "brabo-mounted-ws-#{System.unique_integer([:positive])}")

      on_exit(fn -> File.rm_rf!(workspace_path) end)
      insert_mounted_project!(project_id, workspace_path)
      insert_container_lifecycle!(project_id, "'running'")

      Process.put(
        :fake_container_exec,
        {:ok,
         %{"sucesso" => true, "exitCode" => 0, "output" => "do container\n", "timedOut" => false}}
      )

      result = TerminalExecutor.run(project_id, "npm test")

      assert result.exit_code == 0
      assert result.stdout =~ "do container"
      assert_receive {:container_exec, ^project_id, "npm test", _cwd, _timeout}
    end

    # O catch-all encolheu para ISTO, e só isto: nenhum modo de execução cai
    # mais no `System.cmd` local.
    test "projeto inexistente é o único caso que ainda cai no caminho de sempre" do
      force_rtk_unavailable!()
      bare = create_bare_repo_with_commit!()
      project_id = unique_project_id()
      insert_project_repository!(project_id, bare)
      # SEM insert_container_project!/insert_mounted_project! — não há linha em
      # `projects`, então `Project.get/1` devolve `nil`.

      result = TerminalExecutor.run(project_id, "echo oi")

      assert result.exit_code == 0
      assert result.stdout =~ "oi"
    end
  end
end
