defmodule Engine.Harness.FluxoDoTimeTest do
  @moduledoc "RN-711 (AT-369): o texto do fluxo, conferido contra `docs/fluxo.yml`."
  use ExUnit.Case, async: true

  alias Engine.Harness.FluxoDoTime

  @fluxo Path.expand("../../../../../docs/fluxo.yml", __DIR__)

  # Papéis do fluxo.yml com o status de cada um (sem lib de YAML: o arquivo
  # declara um papel por `- id:` seguido do `status:` dele).
  defp papeis_do_fluxo do
    @fluxo
    |> File.read!()
    |> String.split(~r/^\s*- id: /m)
    |> Enum.drop(1)
    |> Map.new(fn bloco ->
      [id | _] = String.split(bloco, ~r/\s/, parts: 2)
      status = Regex.run(~r/^\s+status: (\S+)/m, bloco, capture: :all_but_first)
      {id, status && hd(status)}
    end)
  end

  # Nomes que um texto de fluxo poderia citar e que NÃO são etapa ativa.
  @fora_do_fluxo ~w(InfraAgent Platform platform Analytics deploy Dockerfile pipeline DBRE)

  test "todo papel citado existe no fluxo.yml como ativo (ou, lateral, planned)" do
    papeis = papeis_do_fluxo()

    for etapa <- FluxoDoTime.etapas() do
      assert papeis[etapa.papel] == "active", "#{etapa.papel} não é ativo no fluxo.yml"
    end

    for {_, l} <- FluxoDoTime.laterais() do
      assert Map.has_key?(papeis, l.papel), "#{l.papel} não existe no fluxo.yml"
    end
  end

  test "a ordem: Criativo → PO → Arquiteto → Infra → Dev Lead → dev agents → QA/SecOps" do
    assert Enum.map(FluxoDoTime.etapas(), & &1.papel) ==
             ~w(criativo po arquiteto area-infra dev-lead dev area-qa)
  end

  test "nenhum texto cita etapa/agente fora do fluxo" do
    for agente <- ~w(criativo po arquiteto infra dev-lead ux-designer staff) do
      t = FluxoDoTime.texto(agente)
      assert is_binary(t)

      for proibido <- @fora_do_fluxo do
        refute t =~ proibido, "o fluxo de #{agente} cita #{proibido}"
      end
    end
  end

  test "o próximo passo de cada etapa é o real, com quem dispara" do
    assert FluxoDoTime.texto("criativo") =~ "Próximo passo real: o humano clica \"Estou pronto"
    assert FluxoDoTime.texto("criativo") =~ "põe o PO"
    assert FluxoDoTime.texto("po") =~ "Próximo passo real: o PO oferece o handoff ao Arquiteto"
    assert FluxoDoTime.texto("arquiteto") =~ "não implementa"
    assert FluxoDoTime.texto("dev-lead") =~ "ATIVA a execução"
  end

  test "anexar: efêmera no fim só para conversacional" do
    h = [%{"role" => "user", "content" => "oi"}]
    assert [_, %{"role" => "system", "content" => c}] = FluxoDoTime.anexar(h, "po")
    assert c =~ "Fluxo de entrega"
    assert FluxoDoTime.anexar(h, "dev-api") == h
    assert FluxoDoTime.anexar(h, "context-manager") == h
  end
end
