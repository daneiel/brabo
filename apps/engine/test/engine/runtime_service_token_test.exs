defmodule Engine.RuntimeServiceTokenTest do
  @moduledoc """
  A régua dos tokens de serviço no `config/runtime.exs` (RN-601).

  É a MESMA régua que a api aplica em `exigirTokenDeProducao` (RN-114/RN-598):
  trim, piso de 16 caracteres e recusa do literal público de dev em produção,
  para o atual e para o anterior; o atual é obrigatório em produção e o
  anterior não; anterior igual ao atual não é rotação.

  O teste avalia o `runtime.exs` DE VERDADE, por `Config.Reader.read!/2` com o
  `config_env` pedido — não uma cópia da régua —, porque é ali que ela mora
  (numa release o arquivo roda antes de o código da aplicação ser carregado).
  Mexe em variável de ambiente do SO, por isso `async: false`.
  """
  use ExUnit.Case, async: false

  @runtime Path.expand("../../config/runtime.exs", __DIR__)
  @padrao "dev-service-token-change-me"
  @forte "um-token-de-servico-forte-0123456789"
  @forte_anterior "o-token-de-servico-anterior-0123456789"

  # O bloco `:prod` do runtime.exs exige estas duas antes de chegar ao fim do
  # arquivo; sem elas o `raise` seria o delas, não o do token.
  @obrigatorias_de_prod %{
    "DATABASE_URL" => "ecto://u:p@localhost/db",
    "SECRET_KEY_BASE" => String.duplicate("s", 64)
  }

  @variaveis [
    "BRABO_SERVICE_TOKEN",
    "BRABO_SERVICE_TOKEN_PREVIOUS" | Map.keys(@obrigatorias_de_prod)
  ]

  setup do
    antes = Map.new(@variaveis, &{&1, System.get_env(&1)})

    on_exit(fn ->
      Enum.each(antes, fn
        {nome, nil} -> System.delete_env(nome)
        {nome, valor} -> System.put_env(nome, valor)
      end)
    end)

    Enum.each(@variaveis, &System.delete_env/1)
    :ok
  end

  defp ler(env, variaveis) do
    if env == :prod, do: System.put_env(@obrigatorias_de_prod)

    Enum.each(variaveis, fn
      {nome, nil} -> System.delete_env(nome)
      {nome, valor} -> System.put_env(nome, valor)
    end)

    config = Config.Reader.read!(@runtime, env: env, target: :host)
    engine = Keyword.fetch!(config, :engine)
    {Keyword.fetch!(engine, :service_token), Keyword.fetch!(engine, :service_token_previous)}
  end

  defp recusa(variaveis) do
    assert_raise RuntimeError, fn -> ler(:prod, variaveis) end
  end

  describe "produção — o atual" do
    test "aceita um token forte, sem o espaço em volta" do
      assert {@forte, nil} = ler(:prod, %{"BRABO_SERVICE_TOKEN" => "  #{@forte}\n"})
    end

    test "ausente derruba o boot nomeando a variável" do
      erro = recusa(%{})
      assert erro.message =~ "BRABO_SERVICE_TOKEN é obrigatória em produção"
    end

    test "feito só de espaço conta como ausente" do
      erro = recusa(%{"BRABO_SERVICE_TOKEN" => "   "})
      assert erro.message =~ "BRABO_SERVICE_TOKEN é obrigatória em produção"
    end

    test "o literal público de dev derruba o boot" do
      erro = recusa(%{"BRABO_SERVICE_TOKEN" => " #{@padrao} "})
      assert erro.message =~ "BRABO_SERVICE_TOKEN está com o valor de exemplo"
    end

    test "abaixo de 16 caracteres (depois do trim) derruba o boot" do
      erro = recusa(%{"BRABO_SERVICE_TOKEN" => "  curto-15-chars  "})
      assert erro.message =~ "BRABO_SERVICE_TOKEN tem 14 caracteres"
      assert erro.message =~ "mínimo em produção é 16"
    end
  end

  describe "produção — o anterior (rotação)" do
    test "aceito quando forte, sem o espaço em volta" do
      assert {@forte, @forte_anterior} =
               ler(:prod, %{
                 "BRABO_SERVICE_TOKEN" => @forte,
                 "BRABO_SERVICE_TOKEN_PREVIOUS" => " #{@forte_anterior} "
               })
    end

    test "ausente ou só espaço é `nil`, sem recusa" do
      assert {@forte, nil} = ler(:prod, %{"BRABO_SERVICE_TOKEN" => @forte})

      assert {@forte, nil} =
               ler(:prod, %{
                 "BRABO_SERVICE_TOKEN" => @forte,
                 "BRABO_SERVICE_TOKEN_PREVIOUS" => "  "
               })
    end

    test "o literal público de dev derruba o boot nomeando o anterior" do
      erro =
        recusa(%{"BRABO_SERVICE_TOKEN" => @forte, "BRABO_SERVICE_TOKEN_PREVIOUS" => @padrao})

      assert erro.message =~ "BRABO_SERVICE_TOKEN_PREVIOUS está com o valor de exemplo"
    end

    test "curto derruba o boot nomeando o anterior" do
      erro =
        recusa(%{"BRABO_SERVICE_TOKEN" => @forte, "BRABO_SERVICE_TOKEN_PREVIOUS" => "curto"})

      assert erro.message =~ "BRABO_SERVICE_TOKEN_PREVIOUS tem 5 caracteres"
    end

    test "igual ao atual (depois do trim) não é rotação e vira `nil`" do
      assert {@forte, nil} =
               ler(:prod, %{
                 "BRABO_SERVICE_TOKEN" => @forte,
                 "BRABO_SERVICE_TOKEN_PREVIOUS" => "  #{@forte}  "
               })
    end
  end

  describe "fora de produção" do
    test "ausente ou só espaço cai no default de dev" do
      assert {@padrao, nil} = ler(:dev, %{})
      assert {@padrao, nil} = ler(:dev, %{"BRABO_SERVICE_TOKEN" => "  "})
    end

    test "não aplica piso nem recusa o literal, mas faz trim nos dois" do
      assert {"curto", @padrao} =
               ler(:dev, %{
                 "BRABO_SERVICE_TOKEN" => " curto ",
                 "BRABO_SERVICE_TOKEN_PREVIOUS" => " #{@padrao} "
               })
    end

    test "anterior igual ao atual vira `nil`" do
      assert {@padrao, nil} = ler(:dev, %{"BRABO_SERVICE_TOKEN_PREVIOUS" => @padrao})
    end
  end
end
