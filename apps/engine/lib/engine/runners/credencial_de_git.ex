defmodule Engine.Runners.CredencialDeGit do
  @moduledoc """
  A recusa da RN-558: a credencial de git (ADR 0056) NÃO atravessa o
  `docker exec` do runner, e desde esta entrega isso é um desfecho NOMEADO em
  vez de um descarte em silêncio.

  ## O que acontecia

  `Engine.Runners.RunnerReadiness` (RN-507, ADR 0145) exige container `running`
  REGISTRADO antes de QUALQUER operação de `Engine.Actions.Workspace.RunnerGit`
  — inclusive o `git fetch` autenticado inicial. Mas a única forma de esse
  registro existir num projeto `runner` é o MESMO runner ter subido o próprio
  container, e é esse mesmo sucesso que marca `estado.containerAtivo` nele (os
  dois nascem do mesmo evento). Com `containerAtivo` setado, `tratarExec`
  (`apps/runner/src/index.ts`) roteia para dentro do container, e a operação
  `exec` de `packages/docker-port` não tem campo de `env` — de propósito (ADR
  0130: sem `-e` livre nenhum). Ou seja: no instante em que a RN-507 deixa o
  `fetch` autenticado rodar, o container quase sempre já está de pé, e era aí
  que a credencial era descartada — sem erro, sem aviso. O `git fetch` saía com
  o helper instalado e as variáveis VAZIAS, e falhava como se o token
  estivesse errado ou a rede fora.

  ## Onde a recusa mora, e por que não aqui

  No RUNNER, e só nele: é o único processo que sabe as duas metades ao mesmo
  tempo (o comando carrega credencial E vai para dentro do container). O
  engine não pode responder a segunda — `containerAtivo` nasce `null` a cada
  execução do runner e só é setado por `tratarContainerStart`, então um
  container `running` REGISTRADO no banco NÃO implica container ativo naquele
  processo: um runner reiniciado com o container de pé roteia pro HOST, e aí a
  credencial chega normalmente. Subir a checagem para `RunnerReadiness` ou
  para `RunnerGit` recusaria um caminho que funciona.

  Este módulo é o outro lado: RECONHECE a recusa do runner pela MARCA que ela
  carrega, e traduz em mensagem e ORIGEM. É o único lugar do engine que
  conhece a marca — quem precisa dela chama daqui.

  ## Por que `politica` e não `codigo`

  As quatro origens do ADR 0020 apontam AÇÃO, não culpa. Isto não é uma
  cláusula que ninguém escreveu (`codigo`), nem uma rede que caiu (`infra`):
  é a contenção do ADR 0130 — a porta de Docker não tem campo de `env`, por
  decisão — funcionando exatamente como foi desenhada, contra um caso que ela
  não previu. Quem lê `politica` sabe que não há bug para caçar: há uma
  decisão de produto a tomar (ver a lacuna declarada na RN-558).
  """

  # A marca que o runner põe na saída da recusa. Constante de PROTOCOLO — o par
  # dela é `MARCA_DE_CREDENCIAL_NAO_ENTREGUE`, em `apps/runner/src/index.ts`, e
  # `scripts/ci/marca-de-credencial-do-runner.spec.ts` reprova quem mudar um
  # lado só (nenhuma das duas suítes alcança a outra linguagem).
  @marca "credencial-nao-atravessa-o-container"

  @doc """
  A marca literal, para quem precisar asserir sobre ela (teste) sem
  redigitá-la. O par dela vive em `apps/runner/src/index.ts`
  (`MARCA_DE_CREDENCIAL_NAO_ENTREGUE`).
  """
  @spec marca() :: String.t()
  def marca, do: @marca

  @doc """
  `true` quando o texto é (ou contém) a recusa nomeada do runner. Aceita
  qualquer termo — `nil`, átomo, tupla — porque os chamadores recebem `reason`
  já normalizado de formas diferentes e nenhum deles deve precisar saber disso.
  """
  @spec recusada?(term()) :: boolean()
  def recusada?(texto) when is_binary(texto), do: String.contains?(texto, @marca)
  def recusada?(_outro), do: false

  @doc """
  A mensagem que `Engine.Actions.Workspace.RunnerGit` levanta quando o runner
  recusa. CARREGA a marca — é por ela que `desfecho/1` classifica lá na frente,
  depois de a mensagem já ter atravessado um `rescue`/`Exception.message/1` e
  virado string solta.

  `saida_do_runner` vai junto, verbatim: mesma régua de
  `Engine.Agents.FalhaDeTurno` — o diagnóstico nunca se perde no caminho.
  """
  @spec mensagem(String.t(), String.t()) :: String.t()
  def mensagem(project_id, saida_do_runner) do
    "o `git fetch` autenticado não pôde rodar no projeto #{project_id}: " <>
      "a credencial de git (ADR 0056) viaja no campo `env` do `exec`, e o runner " <>
      "recusou o comando porque tem um container ativo — todo comando vai para " <>
      "dentro dele por `docker exec`, que não tem campo de `env` (ADR 0130). " <>
      "NADA foi executado, e a credencial não vazou. Isto não é token inválido " <>
      "nem falha de rede (#{@marca}). Enquanto a metade que falta não existir, " <>
      "clone/fetch de repositório remoto AUTENTICADO em modo `runner` só funciona " <>
      "com o container parado. Recusa do runner, verbatim: #{saida_do_runner}"
  end

  @doc """
  O desfecho que um dev agent registra quando a criação do worktree falha:
  `{motivo_curto, origem}`, com a origem no vocabulário fechado do ADR 0020.

  A recusa da RN-558 tem motivo PRÓPRIO e origem `politica`; qualquer outra
  falha mantém byte a byte o que os dois dev agents já registravam antes desta
  entrega (`"falha ao preparar o worktree"`, `"codigo"`) — esta função nasceu
  para acrescentar UM caso, nunca para reclassificar os outros.
  """
  @spec desfecho(term()) :: {String.t(), String.t()}
  def desfecho(reason) do
    if recusada?(reason) do
      {"credencial de git não atravessa o container do runner", "politica"}
    else
      {"falha ao preparar o worktree", "codigo"}
    end
  end
end
