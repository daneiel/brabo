defmodule Engine.Runners.EspelhoTest do
  @moduledoc """
  O PREDICADO próprio do espelho e o empurrão de `mirror_sync` (ADR 0147
  pontos 3/4/8, RN-516).

  `async: false`: `Engine.Runners.Registry` usa `:global`, que é global ao
  node de teste inteiro (mesmo motivo de `EngineWeb.TerminalChannelTest`).

  O que este arquivo prova, e é a razão de ele existir separado: o espelho tem
  DUAS pré-condições, e a TERCEIRA de `Engine.Runners.RunnerReadiness`
  (container REGISTRADO `running`, RN-507) NÃO se aplica a ele. Cópia de
  arquivo na máquina do usuário não tem container de onde cair em silêncio —
  exigir Docker seria importar uma pré-condição sem o defeito que a justifica,
  e justamente na capacidade que deve funcionar para quem não quer Docker.
  """

  use Engine.DataCase, async: false

  alias Engine.Runners.{Espelho, Registry}

  defp inserir_projeto!(opts) do
    project_id = Ecto.UUID.generate()

    Engine.Repo.query!(
      "INSERT INTO public.projects " <>
        "(id, name, slug, workspace_dir_name, execution_mode, workspace_path, " <>
        "workspace_verified_at, mirror_path) " <>
        "VALUES ($1, 'proj', 'proj', 'proj-abc12345', $2, $3, $4, $5)",
      [
        Ecto.UUID.dump!(project_id),
        Keyword.get(opts, :execution_mode, "runner"),
        Keyword.get(opts, :workspace_path, "/home/voce/projetos/proj"),
        Keyword.get(opts, :workspace_verified_at, ~U[2026-09-07 03:00:00Z]),
        Keyword.get(opts, :mirror_path)
      ]
    )

    project_id
  end

  defp conectar_runner!(project_id) do
    :ok = Registry.register(project_id, self())
    on_exit(fn -> Registry.unregister(project_id) end)
  end

  describe "verificar/1 — as DUAS pré-condições do espelho" do
    test "sem destino declarado: `:sem_destino` — e é o estado NORMAL, não uma pendência" do
      project_id = inserir_projeto!(mirror_path: nil)
      conectar_runner!(project_id)

      assert {:erro, :sem_destino} = Espelho.verificar(project_id)
    end

    test "destino em BRANCO conta como ausente — linha malformada não é destino" do
      project_id = inserir_projeto!(mirror_path: "   ")
      conectar_runner!(project_id)

      assert {:erro, :sem_destino} = Espelho.verificar(project_id)
    end

    test "workspace ainda NÃO confirmado: `:nao_verificado`, mesmo com destino e runner" do
      project_id =
        inserir_projeto!(mirror_path: "/home/voce/espelhos/proj", workspace_verified_at: nil)

      conectar_runner!(project_id)

      assert {:erro, :nao_verificado} = Espelho.verificar(project_id)
    end

    test "sem runner conectado: `:desconectado` — quem copia é o agente local" do
      project_id = inserir_projeto!(mirror_path: "/home/voce/espelhos/proj")

      assert {:erro, :desconectado} = Espelho.verificar(project_id)
    end

    test "destino + workspace confirmado + runner conectado é `:pronto` SEM container nenhum" do
      # Nenhum `container_running!/1` aqui, e é o ponto do teste: a TERCEIRA
      # pré-condição de `RunnerReadiness` (RN-507) não existe para o espelho.
      project_id = inserir_projeto!(mirror_path: "/home/voce/espelhos/proj")
      conectar_runner!(project_id)

      assert {:pronto, "/home/voce/espelhos/proj"} = Espelho.verificar(project_id)
    end

    test "o espelho NÃO pergunta o `execution_mode` — quem já decidiu isso foi a api" do
      # `mounted` também espelha (RN-515 só recusa `container`), e repetir a
      # decisão aqui seria a segunda fonte da mesma regra.
      project_id =
        inserir_projeto!(execution_mode: "mounted", mirror_path: "/home/voce/espelhos/proj")

      conectar_runner!(project_id)

      assert {:pronto, _} = Espelho.verificar(project_id)
    end

    test "projeto inexistente e id malformado caem em `:sem_destino`, nunca em `:pronto`" do
      assert {:erro, :sem_destino} = Espelho.verificar(Ecto.UUID.generate())
      assert {:erro, :sem_destino} = Espelho.verificar("nao-e-um-uuid")
    end
  end

  describe "destino/1" do
    test "devolve o destino aparado, ou `nil` quando não há" do
      com = inserir_projeto!(mirror_path: " /home/voce/espelhos/proj ")
      sem = inserir_projeto!(mirror_path: nil)

      assert Espelho.destino(com) == "/home/voce/espelhos/proj"
      assert Espelho.destino(sem) == nil
      assert Espelho.destino("nao-e-um-uuid") == nil
    end

    test "não exige workspace confirmado nem runner conectado — é a leitura do JOIN" do
      # No `join` a conexão está NASCENDO: `workspace_confirm` só chega depois
      # dela, e o `Registry` só é escrito depois da concessão.
      project_id =
        inserir_projeto!(mirror_path: "/home/voce/espelhos/proj", workspace_verified_at: nil)

      assert Espelho.destino(project_id) == "/home/voce/espelhos/proj"
    end
  end

  describe "sincronizar/2" do
    test "empurra `:dispatch_mirror_sync` com o destino e o momento nomeado" do
      project_id = inserir_projeto!(mirror_path: "/home/voce/espelhos/proj")
      conectar_runner!(project_id)

      assert :ok = Espelho.sincronizar(project_id, "commit")

      assert_receive {:dispatch_mirror_sync, ref, "/home/voce/espelhos/proj", "commit"}
      assert is_binary(ref)
    end

    test "não empurra nada quando falta pré-condição, e devolve o motivo" do
      sem_destino = inserir_projeto!(mirror_path: nil)
      conectar_runner!(sem_destino)

      assert {:erro, :sem_destino} = Espelho.sincronizar(sem_destino, "commit")
      refute_receive {:dispatch_mirror_sync, _, _, _}
    end

    test "`nil` como project_id nunca levanta — o commit não pode virar 500 por causa disto" do
      assert {:erro, :sem_destino} = Espelho.sincronizar(nil, "commit")
    end

    test "FIRE-AND-FORGET: devolve `:ok` sem esperar resposta nenhuma do runner" do
      project_id = inserir_projeto!(mirror_path: "/home/voce/espelhos/proj")
      conectar_runner!(project_id)

      # Ninguém responde a este `send` — e mesmo assim a chamada já retornou.
      assert :ok = Espelho.sincronizar(project_id, "commit")
    end
  end

  describe "mensagem/1" do
    test "cada motivo tem texto próprio — nenhum se disfarça de outro" do
      textos = Enum.map([:sem_destino, :nao_verificado, :desconectado], &Espelho.mensagem/1)

      assert length(Enum.uniq(textos)) == 3
      assert Enum.all?(textos, &(String.length(&1) > 20))
    end
  end
end
