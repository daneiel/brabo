defmodule Engine.Dev.FakeWorktreeManager do
  @moduledoc "Fake do WorktreeManager pros testes do DevAgentServer — sem git real."

  def create(_project_id, _agent_id, slug) do
    path =
      Path.join(
        System.tmp_dir!(),
        "brabo-fake-wt-#{slug}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(path)
    {:ok, %{path: path, branch: "feature/#{slug}"}}
  end
end
