defmodule Engine.Infra.Tools.ProposeInfraPrTest do
  use ExUnit.Case, async: true

  alias Engine.Infra.Tools.ProposeInfraPr

  test "a spec declara run.app opcional com command e port" do
    run = get_in(ProposeInfraPr.spec(), [:parameters, "properties", "run"])
    app = run["properties"]["app"]

    assert app["properties"]["port"] == %{
             "type" => "integer",
             "minimum" => 1024,
             "maximum" => 65_535
           }

    assert app["required"] == ["command", "port"]
    refute "app" in run["required"]
    assert app["description"] =~ "DENTRO do container de trabalho"
  end
end
