defmodule EngineWeb.SessionSocket do
  @moduledoc """
  Socket de heartbeat de sessão.

  LIMITAÇÃO DELIBERADA nesta fase: sem autenticação em connect/3 — a
  única barreira é o session_id (UUID) precisar existir no Registry no
  momento do join. "Por ora, teste via wscat" (spec original). Isso NÃO
  é seguro pra produção; fechar esse gap (validar um token de sessão, por
  exemplo) é pré-requisito antes de sair de dev/teste.
  """

  use Phoenix.Socket

  channel "session:*", EngineWeb.SessionChannel

  @impl true
  def connect(_params, socket, _connect_info), do: {:ok, socket}

  @impl true
  def id(_socket), do: nil
end
