defmodule Engine.Gates.ScannerTest do
  # async: false — mexe no Application.env global (:secops_scan_timeout_ms).
  use ExUnit.Case, async: false

  alias Engine.Gates.Scanner

  defmodule Verde do
    @behaviour Engine.Actions.GitleaksDetector
    @impl true
    def available?, do: true
    @impl true
    def scan(_path), do: {:ok, []}
  end

  defmodule Achou do
    @behaviour Engine.Actions.GitleaksDetector
    @impl true
    def available?, do: true
    @impl true
    def scan(_path), do: {:ok, [%{tool: "gitleaks", path: "a.js", line: 1, message: "segredo"}]}
  end

  defmodule Ausente do
    @behaviour Engine.Actions.GitleaksDetector
    @impl true
    def available?, do: false
    @impl true
    def scan(_path), do: :unavailable
  end

  defmodule Pendurado do
    @behaviour Engine.Actions.GitleaksDetector
    @impl true
    def available?, do: true
    @impl true
    def scan(_path) do
      Process.sleep(:infinity)
      {:ok, []}
    end
  end

  defmodule Explode do
    @behaviour Engine.Actions.GitleaksDetector
    @impl true
    def available?, do: true
    @impl true
    def scan(_path), do: raise("boom")
  end

  setup do
    anterior = Application.fetch_env!(:engine, :secops_scan_timeout_ms)
    Application.put_env(:engine, :secops_scan_timeout_ms, 50)
    on_exit(fn -> Application.put_env(:engine, :secops_scan_timeout_ms, anterior) end)
    :ok
  end

  test "scanner limpo: sem achados e sem nota de pulo" do
    assert {[], nil} = Scanner.run(Verde, "/tmp", "gitleaks")
  end

  test "scanner com achado: devolve os achados, sem nota de pulo" do
    assert {[finding], nil} = Scanner.run(Achou, "/tmp", "gitleaks")
    assert finding.message == "segredo"
  end

  test "scanner ausente: pulado, sem nem tentar rodar" do
    assert {[], "gitleaks indisponível, pulado"} = Scanner.run(Ausente, "/tmp", "gitleaks")
  end

  test "scanner pendurado: estoura o teto e é pulado, sem congelar o gate" do
    # É o cenário que motivou o teto (ADR 0020): sem ele, um `semgrep --config
    # auto` travado na rede congelaria o handle_cast do gate pra sempre.
    assert {[], nota} = Scanner.run(Pendurado, "/tmp", "semgrep")
    assert nota =~ "semgrep estourou 50ms, pulado"
  end

  test "scanner que explode: pulado com o motivo, nunca derruba o chamador" do
    assert {[], nota} = Scanner.run(Explode, "/tmp", "semgrep")
    assert nota =~ "semgrep falhou"
  end
end
