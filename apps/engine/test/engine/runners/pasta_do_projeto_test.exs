defmodule Engine.Runners.PastaDoProjetoTest do
  @moduledoc """
  O PREDICADO próprio da criação de pasta e o pedido `workspace_create`
  (ADR 0151 pontos 3, 5 e 6; RN-532).

  `async: false`: `Engine.Runners.Registry` usa `:global`, que é global ao
  node de teste inteiro (mesmo motivo de `Engine.Runners.EspelhoTest`).

  O que este arquivo prova, e é a razão de ele existir separado: criar pasta
  tem DUAS pré-condições, e a TERCEIRA de `Engine.Runners.RunnerReadiness`
  (container REGISTRADO `running`, RN-507) não só não se aplica como seria
  CIRCULAR — um projeto `runner` só chega a ter container `running` depois de
  o próprio runner o subir, e o container sobe sobre a pasta que esta mensagem
  existe para criar.

  Sem `Engine.DataCase`, e isso é a asserção: este módulo NÃO consulta o
  projeto no banco. Ele não pergunta `workspace_verified_at` (que aqui é o
  RESULTADO, não a pré-condição) nem `execution_mode` — e um teste que
  precisasse de banco esconderia isso.
  """

  use ExUnit.Case, async: false

  alias Engine.Runners.{PastaDoProjeto, Registry}

  defp unique_project_id, do: Ecto.UUID.generate()

  # Mesmo molde de `Engine.Runners.RunnerRouterTest`: `criar/3` bloqueia em
  # `receive`, então o processo de teste não pode esperar por si mesmo.
  defp fake_runner!(project_id, responder) do
    parent = self()

    pid =
      spawn(fn ->
        :ok = Registry.register(project_id, self())
        send(parent, :fake_runner_ready)

        receive do
          {:dispatch_workspace_create, ref, payload, from, _timeout_ms} ->
            send(parent, {:pedido_recebido, payload})
            send(from, {:runner_workspace_create_result, ref, responder.(payload)})
        end
      end)

    assert_receive :fake_runner_ready, 1_000
    on_exit(fn -> Process.exit(pid, :kill) end)
    pid
  end

  describe "verificar/1 — a pré-condição que ESTE processo consegue responder" do
    test "sem runner conectado: `:desconectado`" do
      assert {:erro, :desconectado} = PastaDoProjeto.verificar(unique_project_id())
    end

    test "com runner conectado: `:pronto` SEM container, SEM workspace confirmado, SEM banco" do
      # Nenhum `container_running!/1` e nenhuma linha em `projects`: a terceira
      # pré-condição de `RunnerReadiness` não existe aqui, e o
      # `workspace_verified_at` é o RESULTADO desta operação, não a entrada.
      project_id = unique_project_id()
      :ok = Registry.register(project_id, self())
      on_exit(fn -> Registry.unregister(project_id) end)

      assert :pronto = PastaDoProjeto.verificar(project_id)
    end

    test "id malformado e `nil` caem em `:desconectado`, nunca em `:pronto`" do
      assert {:erro, :desconectado} = PastaDoProjeto.verificar("nao-e-um-uuid")
      assert {:erro, :desconectado} = PastaDoProjeto.verificar(nil)
    end
  end

  describe "criar/3 — caminho feliz" do
    test "manda `projectId` e o SEGMENTO, e devolve o caminho que o runner criou" do
      project_id = unique_project_id()

      fake_runner!(project_id, fn _payload ->
        %{"sucesso" => true, "caminho" => "/home/voce/projetos/loja"}
      end)

      assert {:ok, "/home/voce/projetos/loja"} = PastaDoProjeto.criar(project_id, "loja")

      assert_receive {:pedido_recebido, payload}
      assert payload == %{projectId: project_id, segmento: "loja"}
      # Nenhum caminho ABSOLUTO atravessou a rede (ADR 0130/0144): quem tem a
      # raiz é quem executa, e o servidor mandou só o pedaço que ela não cobre.
      refute Map.has_key?(payload, :base)
    end

    test "`repo_url` e `env` entram no payload; ausentes, SOMEM em vez de virar `null`" do
      project_id = unique_project_id()

      fake_runner!(project_id, fn _payload ->
        %{"sucesso" => true, "caminho" => "/home/voce/projetos/loja"}
      end)

      assert {:ok, _} =
               PastaDoProjeto.criar(project_id, "loja",
                 repo_url: "https://exemplo/loja.git",
                 env: %{"GIT_ASKPASS" => "/bin/true"}
               )

      assert_receive {:pedido_recebido, payload}

      assert payload == %{
               projectId: project_id,
               segmento: "loja",
               repoUrl: "https://exemplo/loja.git",
               env: %{"GIT_ASKPASS" => "/bin/true"}
             }
    end
  end

  describe "criar/3 — as recusas, e nenhuma se disfarça de outra" do
    test "sem runner conectado nem chega a despachar" do
      assert {:erro, :desconectado, mensagem} =
               PastaDoProjeto.criar(unique_project_id(), "loja")

      assert mensagem =~ "brabo-runner"
    end

    test "runner que responde `sem-base` vira `:sem_base`, com o conserto na mensagem" do
      project_id = unique_project_id()

      fake_runner!(project_id, fn _payload ->
        %{"sucesso" => false, "motivo" => "sem-base", "erro" => "sem base consentida aqui"}
      end)

      assert {:erro, :sem_base, "sem base consentida aqui"} =
               PastaDoProjeto.criar(project_id, "loja")
    end

    test "os outros motivos do runner viram `:recusado` COM a mensagem dele" do
      project_id = unique_project_id()

      fake_runner!(project_id, fn _payload ->
        %{"sucesso" => false, "motivo" => "git", "erro" => "fatal: repositório não encontrado"}
      end)

      assert {:erro, :recusado, "fatal: repositório não encontrado"} =
               PastaDoProjeto.criar(project_id, "loja")
    end

    test "sucesso SEM caminho não vira sucesso por omissão (RN-088)" do
      project_id = unique_project_id()

      fake_runner!(project_id, fn _payload -> %{"sucesso" => true} end)

      assert {:erro, :recusado, mensagem} = PastaDoProjeto.criar(project_id, "loja")
      assert mensagem =~ "sem informar o caminho"
    end

    test "runner que nunca responde vira `:timeout` NOMEADO, nunca crash" do
      project_id = unique_project_id()
      :ok = Registry.register(project_id, self())
      on_exit(fn -> Registry.unregister(project_id) end)

      assert {:erro, :timeout, mensagem} =
               PastaDoProjeto.criar(project_id, "loja", timeout_ms: 50)

      assert mensagem =~ "não respondeu"
    end

    test "segmento que não é string é recusado ANTES de qualquer despacho" do
      project_id = unique_project_id()
      :ok = Registry.register(project_id, self())
      on_exit(fn -> Registry.unregister(project_id) end)

      assert {:erro, :recusado, _} = PastaDoProjeto.criar(project_id, nil)
      refute_receive {:dispatch_workspace_create, _, _, _, _}
    end
  end

  describe "mensagem/1" do
    test "cada motivo tem texto próprio — nenhum se disfarça de outro" do
      textos =
        Enum.map([:desconectado, :sem_base, :timeout, :recusado], &PastaDoProjeto.mensagem/1)

      assert length(Enum.uniq(textos)) == 4
      assert Enum.all?(textos, &(String.length(&1) > 20))
    end

    test "`:sem_base` nomeia as DUAS causas possíveis — binário velho, ou sem base" do
      # Colapsá-las mandaria metade dos usuários investigar o lado errado: a
      # capacidade ausente é a mesma, o conserto não.
      mensagem = PastaDoProjeto.mensagem(:sem_base)
      assert mensagem =~ "anterior a esta versão"
      assert mensagem =~ "--base"
    end
  end
end
