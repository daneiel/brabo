defmodule Engine.Repo.Migrations.AddObanJobsTable do
  use Ecto.Migration

  def up do
    Oban.Migration.up(prefix: "engine")
  end

  def down do
    Oban.Migration.down(prefix: "engine", version: 1)
  end
end
