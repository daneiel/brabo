defmodule Engine.Actions.RtkDetector do
  @moduledoc """
  Contrato pra detectar/consultar o binário `rtk` (proxy opcional de
  otimização de tokens — 100% hipotético neste ambiente, não instalado,
  não documentado no repo; ver plano). Trocável em teste via
  `Application.get_env(:engine, :rtk_detector, ...)`, mesmo padrão de
  EngineApiClient.
  """

  @callback available?() :: boolean()
  @callback gain_ratio() :: float() | nil
end

defmodule Engine.Actions.RtkDetector.Live do
  @moduledoc """
  Feature-detecta via System.find_executable/1 — nunca assume que `rtk`
  está instalado. `gain_ratio/0` só chama o comando de analytics
  read-only `rtk gain` (nunca reexecuta o comando real do usuário, pra
  não rodar duas vezes algo com efeito colateral) e faz parsing
  best-effort da primeira porcentagem que aparecer na saída — sem
  contrato de saída documentado pro rtk, qualquer formato inesperado
  vira `nil`, nunca derruba a ação principal.
  """

  @behaviour Engine.Actions.RtkDetector

  @impl true
  def available?, do: System.find_executable("rtk") != nil

  @impl true
  def gain_ratio do
    if available?() do
      case System.cmd("rtk", ["gain"], stderr_to_stdout: true) do
        {output, 0} -> parse_ratio(output)
        _ -> nil
      end
    end
  rescue
    _ -> nil
  end

  defp parse_ratio(output) do
    case Regex.run(~r/(\d+(?:\.\d+)?)\s*%/, output) do
      [_, percent] ->
        case Float.parse(percent) do
          {value, _} -> value / 100.0
          :error -> nil
        end

      _ ->
        nil
    end
  end
end

defmodule Engine.Actions.RtkDetector.Fake do
  @moduledoc "Controlado via Application.env — sem Mox, sem Agent."

  @behaviour Engine.Actions.RtkDetector

  @impl true
  def available?, do: Application.get_env(:engine, :rtk_fake_available, false)

  @impl true
  def gain_ratio, do: Application.get_env(:engine, :rtk_fake_gain_ratio, nil)
end
