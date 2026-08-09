defmodule EngineWeb.ChannelCase do
  @moduledoc """
  Suporte para testes de socket/canal Phoenix — `EngineWeb.SessionSocket` e
  `EngineWeb.SessionChannel` (RN-108). Mesmo sandbox de `Engine.DataCase`;
  `Phoenix.ChannelTest` é IMPORTADO, não `use`ado — `use Phoenix.ChannelTest`
  está deprecated na versão instalada (1.8.9) e emite warning.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest
      import EngineWeb.ChannelCase

      @endpoint EngineWeb.Endpoint
    end
  end

  setup tags do
    Engine.DataCase.setup_sandbox(tags)
    :ok
  end
end
