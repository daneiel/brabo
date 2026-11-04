defmodule EngineWeb.AgentCatalogController do
  @moduledoc """
  AT-686 (RN-995): `GET /internal/agents/catalog`, só leitura e sem parâmetro
  (ADR 0060). Service token pelo pipeline `:internal`.
  """
  use EngineWeb, :controller

  def index(conn, _params) do
    json(conn, %{agentes: Engine.Agents.CatalogoDeFerramentas.listar()})
  end
end
