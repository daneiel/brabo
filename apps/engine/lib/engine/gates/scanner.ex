defmodule Engine.Gates.Scanner do
  @moduledoc """
  Execução de um scanner de segurança (semgrep/gitleaks/hadolint) para os
  gates de SecOps — de dev (`Engine.Gates.SecOpsAgentServer`) e de infra
  (`Engine.Infra.InfraGateRunner`), que tinham a mesma função duplicada.

  Duas garantias, ambas no espírito de "o gate nunca trava e nunca mente":

  - **Detecção opcional**: scanner ausente é PULADO e registrado no resumo do
    parecer, nunca quebra o gate (o ambiente pode não ter o binário — ver
    `docker/engine/Dockerfile`, instalação best-effort).
  - **Timeout** (ADR 0020): os detectores chamam `System.cmd`, que não tem
    timeout, DENTRO do `handle_cast` do gate — um `semgrep --config auto` que
    pendura na rede congelaria o gate do projeto inteiro, sem diagnóstico.
    Mesmo idioma do `Engine.Actions.TerminalExecutor.execute/3`: `Task.async` +
    `Task.yield` + `Task.shutdown(:brutal_kill)`. Vale a mesma limitação
    conhecida de lá — o processo do SO pode sobreviver ao shutdown.
  """

  @doc """
  Roda `detector` sobre `path`. Devolve `{findings, nota_de_pulo}` — a nota é
  `nil` quando o scanner rodou, e uma frase pro resumo do parecer quando não.
  """
  def run(detector, path, name) do
    if detector.available?() do
      run_with_timeout(detector, path, name)
    else
      {[], "#{name} indisponível, pulado"}
    end
  end

  defp run_with_timeout(detector, path, name) do
    timeout = Application.fetch_env!(:engine, :secops_scan_timeout_ms)
    task = Task.async(fn -> scan_contido(detector, path) end)

    case Task.yield(task, timeout) || Task.shutdown(task, :brutal_kill) do
      {:ok, {:ok, findings}} -> {findings, nil}
      {:ok, {:error, reason}} -> {[], "#{name} falhou (#{inspect(reason)}), pulado"}
      {:ok, :unavailable} -> {[], "#{name} indisponível, pulado"}
      {:exit, reason} -> {[], "#{name} falhou (#{inspect(reason)}), pulado"}
      nil -> {[], "#{name} estourou #{timeout}ms, pulado"}
    end
  end

  # `Task.async` LINKA a task ao chamador: um detector que levanta exceção
  # derrubaria o GenServer do gate — pior do que a chamada síncrona que havia
  # antes do teto de tempo. Conter aqui dentro transforma a falha num valor de
  # retorno normal, e o gate segue com o scanner "pulado".
  defp scan_contido(detector, path) do
    detector.scan(path)
  rescue
    e -> {:error, e}
  catch
    kind, reason -> {:error, {kind, reason}}
  end
end
