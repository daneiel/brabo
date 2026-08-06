defmodule Engine.Actions.GitAuthTest do
  @moduledoc """
  A decisão 2 do ADR 0056, afirmada onde ela pode ser quebrada por descuido.

  O modo de falha que estes testes existem para impedir não é git parar de
  funcionar — é git funcionar E deixar o token num lugar legível. Um teste que
  só verificasse "o fetch autenticado passou" ficaria verde com a credencial
  gravada no `.git/config`, que é exatamente o caminho errado.
  """

  use ExUnit.Case, async: true

  alias Engine.Actions.GitAuth

  @remoto_autenticado %{
    kind: :remote,
    origin: "https://github.com/daneiel/hello-api.git",
    default_branch: "main",
    token: "ghp_token_secretissimo",
    username: "x-access-token"
  }

  @remoto_local %{
    kind: :local,
    origin: "/data/git-repos/hello.git",
    default_branch: "main",
    token: nil,
    username: nil
  }

  describe "o token não vaza para lugar nenhum observável" do
    test "não aparece em argv" do
      # `ps` mostra a linha de comando de QUALQUER processo da máquina. Token em
      # argv é token público para quem estiver no mesmo container.
      args = GitAuth.args_de_auth(@remoto_autenticado)

      refute Enum.any?(args, &String.contains?(&1, "ghp_token_secretissimo"))
    end

    test "vai no ambiente do processo filho, e é lá que ele fica" do
      env = GitAuth.env_de_auth(@remoto_autenticado)

      assert {"BRABO_GIT_TOKEN", "ghp_token_secretissimo"} in env
      assert {"BRABO_GIT_USERNAME", "x-access-token"} in env
    end

    test "o helper referencia a variável, nunca o valor" do
      [_, _, "-c", helper] = GitAuth.args_de_auth(@remoto_autenticado)

      assert helper =~ "$BRABO_GIT_TOKEN"
      refute helper =~ "ghp_token_secretissimo"
    end
  end

  test "zera helper herdado antes de instalar o próprio" do
    # Helpers de credencial são acumulativos e o PRIMEIRO a responder ganha. Sem
    # o `credential.helper=` vazio na frente, um helper configurado no host
    # responderia antes — e o git usaria uma credencial que não é a do projeto.
    assert ["-c", "credential.helper=", "-c", "credential.helper=!f()" <> _] =
             GitAuth.args_de_auth(@remoto_autenticado)
  end

  describe "remoto sem token" do
    test "não injeta nada — provider local é o caminho de sempre" do
      assert GitAuth.args_de_auth(@remoto_local) == []
      assert GitAuth.env_de_auth(@remoto_local) == []
    end

    test "token vazio conta como ausente" do
      vazio = %{@remoto_autenticado | token: ""}

      assert GitAuth.args_de_auth(vazio) == []
      assert GitAuth.env_de_auth(vazio) == []
    end

    test "mapa sem a chave token não explode" do
      assert GitAuth.args_de_auth(%{}) == []
      assert GitAuth.env_de_auth(%{}) == []
    end
  end

  test "roda git de verdade no diretório, pelo caminho sem token" do
    dir = Path.join(System.tmp_dir!(), "brabo-gitauth-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)

    {_, 0} = System.cmd("git", ["init"], cd: dir, stderr_to_stdout: true)

    assert {:ok, saida} = GitAuth.run(dir, ["status", "--porcelain"], @remoto_local)
    assert saida == ""
  end

  test "o username default cobre remoto que não o informou" do
    sem_usuario = %{@remoto_autenticado | username: nil}

    assert {"BRABO_GIT_USERNAME", "x-access-token"} in GitAuth.env_de_auth(sem_usuario)
  end
end
