defmodule Engine.Actions.WorkspaceRunnerTest do
  @moduledoc """
  A mensagem de falha de `ensure_remoto/2` em projeto no modo `runner`
  (RN-478).

  A lacuna em si continua ABERTA de propósito — o working tree do dev agent
  não tem onde nascer, porque `workspace_dir/2` devolve o caminho do HOST e o
  engine roda em container sem bind-mount para lá. O que este teste cobra é a
  única coisa que a Parte 0 muda aqui: a falha NOMEIA a causa em vez de
  repassar "permissão negada"/"não é diretório" cru, que manda procurar dono
  de pasta — o diagnóstico errado.

  Precisa do banco (`DataCase`) porque a distinção é feita por `Project.get/1`
  no caminho de falha; `workspace_test.exs`, ao lado, roda sem banco e por
  isso não é o lugar deste caso.
  """
  use Engine.DataCase, async: false

  alias Engine.Actions.Workspace

  defp insert_project!(id, attrs) do
    Repo.query!(
      "INSERT INTO public.projects " <>
        "(id, name, slug, workspace_dir_name, execution_mode, workspace_path) " <>
        "VALUES ($1, 'proj', 'proj', $2, $3, $4)",
      [
        Ecto.UUID.dump!(id),
        Map.get(attrs, :workspace_dir_name),
        Map.get(attrs, :execution_mode),
        Map.get(attrs, :workspace_path)
      ]
    )
  end

  # Uma pasta que NÃO dá para criar, sem depender de permissão de usuário: um
  # ARQUIVO comum no meio do caminho faz o `File.mkdir_p!` de `ensure!/4`
  # falhar com ENOTDIR. O que importa é que ele falhe — o caminho do host de
  # um projeto `runner` não existe dentro do container do engine, e é essa
  # falha que a mensagem tem de explicar.
  defp caminho_impossivel do
    arquivo =
      Path.join(
        System.tmp_dir!(),
        "brabo-pasta-do-host-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    File.write!(arquivo, "")
    on_exit(fn -> File.rm_rf!(arquivo) end)
    Path.join(arquivo, "dev/exp002")
  end

  defp remoto, do: %{origin: "/tmp/nao-existe.git", default_branch: "main"}

  test "projeto `runner`: a falha nomeia a pasta do host e diz o que resolve" do
    id = Ecto.UUID.generate()
    pasta = caminho_impossivel()

    insert_project!(id, %{
      execution_mode: "runner",
      workspace_dir_name: "exp002-f52be111",
      workspace_path: pasta
    })

    assert {:error, mensagem} = Workspace.ensure_remoto(id, remoto())

    assert mensagem =~ "modo `runner`"
    assert mensagem =~ pasta
    assert mensagem =~ "não a enxerga" or mensagem =~ "sem bind-mount"
    # A falha original continua junto: a mensagem EXPLICA, não substitui.
    assert mensagem =~ "Falha original:"
  end

  test "projeto no modo de sempre: a mensagem original passa intacta, sem menção a runner" do
    id = Ecto.UUID.generate()

    insert_project!(id, %{
      execution_mode: "container",
      workspace_dir_name: "loja-abcdefgh"
    })

    Application.put_env(:engine, :project_workspaces_root, caminho_impossivel())

    on_exit(fn ->
      Application.put_env(:engine, :project_workspaces_root, System.tmp_dir!())
    end)

    assert {:error, mensagem} = Workspace.ensure_remoto(id, remoto())

    refute mensagem =~ "runner"
    refute mensagem =~ "Falha original:"
  end
end
