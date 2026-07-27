defmodule Engine.Release do
  @moduledoc """
  Tarefas de operação para rodar DENTRO do release (Fase 5).

  Um release não tem Mix: `mix ecto.migrate` simplesmente não existe na imagem
  de produção. Este módulo é o padrão canônico do Ecto para o caso — chamado
  via `bin/engine eval "Engine.Release.migrate()"`.

  Usado pelo serviço one-shot de migração do `docker-compose.prod.yml`: as
  réplicas de app NÃO migram no boot, senão duas subindo ao mesmo tempo
  competem pela mesma migration.
  """

  @app :engine

  @doc """
  Aplica todas as migrations pendentes de todos os repos do app.

  `Application.load/1` em vez de `ensure_all_started/1`: carrega a config sem
  subir a árvore de supervisão (não queremos o endpoint HTTP, o Oban nem os
  agentes de fundo durante uma migração). O `Ecto.Migrator` levanta o repo
  isolado por conta própria.
  """
  def migrate do
    load_app()

    for repo <- repos() do
      {:ok, _fun_return, _apps} =
        Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end

    :ok
  end

  @doc """
  Desfaz migrations de um repo até a versão dada. Existe para o runbook de
  rollback — nunca é chamado automaticamente.
  """
  def rollback(repo, version) do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))
    :ok
  end

  defp repos do
    Application.fetch_env!(@app, :ecto_repos)
  end

  defp load_app do
    Application.load(@app)
  end
end
