defmodule Engine.Projects.ProjectTest do
  # RN-169/RN-421 (ADR 0072/0104) — os TRÊS modos, nos DOIS fragmentos SQL
  # que derivam o localizador da pasta do workspace. As duas funções
  # (`workspace_dir_name/1` e `all_workspace_dirs/0`) usam a MESMA expressão
  # `case when execution_mode <> 'container' ...` — testadas juntas aqui
  # porque uma delas divergir da outra é exatamente a falha que a derivação
  # única existe para impedir.
  use Engine.DataCase, async: true

  alias Engine.Projects.Project

  defp insert_project!(id, attrs) do
    execution_mode = Map.get(attrs, :execution_mode)
    workspace_path = Map.get(attrs, :workspace_path)
    workspace_dir_name = Map.get(attrs, :workspace_dir_name)

    Repo.query!(
      "INSERT INTO public.projects " <>
        "(id, name, slug, workspace_dir_name, execution_mode, workspace_path) " <>
        "VALUES ($1, 'proj', 'proj', $2, $3, $4)",
      [Ecto.UUID.dump!(id), workspace_dir_name, execution_mode, workspace_path]
    )
  end

  defp unique_id, do: Ecto.UUID.generate()

  describe "workspace_dir_name/1" do
    test "container: devolve o nome de pasta gerenciado" do
      id = unique_id()
      insert_project!(id, %{execution_mode: "container", workspace_dir_name: "loja-abcdefgh"})

      assert Project.workspace_dir_name(id) == "loja-abcdefgh"
    end

    test "container sem workspace_dir_name (nulo no banco): degrada pro id cru" do
      id = unique_id()
      insert_project!(id, %{execution_mode: "container"})

      assert Project.workspace_dir_name(id) == id
    end

    test "container com execution_mode nulo (projeto de antes do ADR 0072): mesmo comportamento" do
      id = unique_id()
      insert_project!(id, %{workspace_dir_name: "loja-abcdefgh"})

      assert Project.workspace_dir_name(id) == "loja-abcdefgh"
    end

    test "mounted: devolve o caminho absoluto do usuário, não o nome de pasta" do
      id = unique_id()

      insert_project!(id, %{
        execution_mode: "mounted",
        workspace_dir_name: "loja-abcdefgh",
        workspace_path: "/home/voce/projetos/loja"
      })

      assert Project.workspace_dir_name(id) == "/home/voce/projetos/loja"
    end

    test "runner: MESMA derivação de mounted — o que muda é fora desta consulta" do
      id = unique_id()

      insert_project!(id, %{
        execution_mode: "runner",
        workspace_dir_name: "loja-abcdefgh",
        workspace_path: "/home/voce/projetos/loja"
      })

      assert Project.workspace_dir_name(id) == "/home/voce/projetos/loja"
    end

    test "id sem forma de UUID: nil, sem consultar o banco" do
      assert Project.workspace_dir_name("nao-e-uuid") == nil
    end

    test "projeto inexistente: nil" do
      assert Project.workspace_dir_name(unique_id()) == nil
    end
  end

  describe "all_workspace_dirs/0" do
    test "mistura os três modos na MESMA consulta, cada um com o localizador certo" do
      container_id = unique_id()
      mounted_id = unique_id()
      runner_id = unique_id()

      insert_project!(container_id, %{
        execution_mode: "container",
        workspace_dir_name: "loja-11111111"
      })

      insert_project!(mounted_id, %{
        execution_mode: "mounted",
        workspace_dir_name: "loja-22222222",
        workspace_path: "/home/voce/projetos/mounted"
      })

      insert_project!(runner_id, %{
        execution_mode: "runner",
        workspace_dir_name: "loja-33333333",
        workspace_path: "/home/voce/projetos/runner"
      })

      dirs =
        Project.all_workspace_dirs()
        |> Enum.filter(&(&1.id in [container_id, mounted_id, runner_id]))
        |> Map.new(&{&1.id, &1.workspace_dir_name})

      assert dirs[container_id] == "loja-11111111"
      assert dirs[mounted_id] == "/home/voce/projetos/mounted"
      assert dirs[runner_id] == "/home/voce/projetos/runner"
    end
  end
end
