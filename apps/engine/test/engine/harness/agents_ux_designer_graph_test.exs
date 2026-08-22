defmodule Engine.Harness.AgentsUxDesignerGraphTest do
  @moduledoc """
  `Agents.identity("ux-designer")` como primeiro consumidor real do grafo de
  conhecimento (Onda 2, frente C1) — grafo quando disponível, fallback pra
  string inline (o texto original do ADR 0087) em qualquer degradação.

  Arquivo PRÓPRIO, `async: false`: mexe em `Application.env` global
  (`:graph_instruction_templates_enabled?`, `:engine_api_client`), o mesmo
  motivo que separa `instruction_files_graph_test.exs` do resto da suite de
  harness — misturar com `agents_test.exs` (`async: true`) arriscaria outro
  teste ler o env a meio caminho da troca.
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Agents
  alias Engine.Harness.InstructionFiles.Cache

  @template "ux-designer-identity"
  # Mesma forma de chave que `InstructionFiles.Live` usa internamente pro
  # cache do template do grafo — o nome é FIXO (hardcoded em `agents.ex`,
  # ao contrário dos testes de `instruction_files_graph_test.exs`, que usam
  # nome único por teste), então sem limpar entre testes o TTL de 60s faria
  # um teste anterior "vazar" resposta cacheada pro seguinte.
  @cache_key {:graph_template, @template, nil}

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())
    Application.put_env(:engine, :graph_instruction_templates_enabled?, false)
    Cache.delete(@cache_key)

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.put_env(:engine, :graph_instruction_templates_enabled?, false)
      Cache.delete(@cache_key)
    end)

    :ok
  end

  test "flag ligada + grafo responde: usa o conteúdo do template do grafo" do
    Application.put_env(:engine, :graph_instruction_templates_enabled?, true)

    Process.put(:fake_prompt_template, %{
      "name" => @template,
      "version" => "1",
      "body" => "identidade vinda do grafo de conhecimento",
      "hash" => "abc"
    })

    assert Agents.identity("ux-designer") == "identidade vinda do grafo de conhecimento"
    assert_received {:prompt_template_fetched, @template, nil}
  end

  test "flag desligada (default): cai no fallback inline, nunca vazio" do
    fallback = Agents.identity("ux-designer")

    assert fallback =~ "UX/Product Designer"
    assert fallback =~ "SISTEMA DE DESIGN"
    refute_received {:prompt_template_fetched, _, _}
  end

  test "flag ligada mas api fora do ar: cai no MESMO fallback inline, nunca vazio" do
    Application.put_env(:engine, :graph_instruction_templates_enabled?, true)
    Process.put(:fake_prompt_template, {:error, :econnrefused})

    assert Agents.identity("ux-designer") =~ "UX/Product Designer"
    assert Agents.identity("ux-designer") =~ "SISTEMA DE DESIGN"
  end

  test "flag ligada mas template ainda não semeado (:not_found): cai no fallback" do
    Application.put_env(:engine, :graph_instruction_templates_enabled?, true)
    Process.put(:fake_prompt_template, {:error, :not_found})

    assert Agents.identity("ux-designer") =~ "UX/Product Designer"
  end

  test "outros agentes continuam intocados pela mudança" do
    assert Agents.identity("arquiteto") =~ "Arquiteto"
    refute_received {:prompt_template_fetched, _, _}
  end
end
