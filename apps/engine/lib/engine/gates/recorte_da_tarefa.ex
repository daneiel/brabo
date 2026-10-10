defmodule Engine.Gates.RecorteDaTarefa do
  @moduledoc """
  O recorte da TAREFA que o gate de QA julga (AT-448, RN-765).

  O QA recebia só a história inteira e reprovava a tarefa por um RF que é de
  uma tarefa IRMÃ ainda pendente ("login HTTP com JWT não existe nesta
  entrega" na tarefa que só modelava a tabela) — e a tarefa bloqueava depois
  de três correções que ela não tinha como fazer. Este módulo monta o texto
  que a QA-estratégia e a QA-automação recebem: título e descrição da tarefa,
  as regras de negócio da história, e as tarefas irmãs com o status (o que
  `GET .../dev-context` devolve em `siblingTasks`) e, desde a AT-461 (RN-785),
  as tarefas não concluídas de OUTRAS histórias do mesmo módulo
  (`moduleOpenTasks`). A régua é dita junto: o
  veredito é sobre o que é DESTA tarefa, e requisito de outra tarefa é
  OBSERVAÇÃO, nunca reprovação. Puro — sem I/O.
  """

  @doc "Texto do recorte, a partir de `dev_context` (`task`, `sibling_tasks`, regras)."
  @spec texto(map()) :: String.t()
  def texto(dev_context) do
    task = Map.get(dev_context, :task, %{})
    irmas = Map.get(dev_context, :sibling_tasks, [])
    regras = Map.get(dev_context, :business_rules_units, [])
    abertas = Map.get(dev_context, :module_open_tasks, [])
    total = Map.get(dev_context, :module_open_tasks_total, length(abertas))
    contrato = Map.get(dev_context, :module_contract)

    """

    RECORTE DESTA TAREFA (o veredito é sobre ele):
    Tarefa: #{Map.get(task, "title", "")}
    #{Map.get(task, "description", "")}

    Regras de negócio da história:
    #{lista(Enum.map(regras, &Map.get(&1, :content, "")))}

    Outras tarefas da MESMA história (não são desta entrega):
    #{lista(Enum.map(irmas, &irma/1))}

    Tarefas ainda NÃO concluídas de OUTRAS histórias do mesmo módulo:
    #{lista(Enum.map(abertas, &aberta/1))}#{corte(abertas, total)}

    Julgue SÓ o que é desta tarefa. Requisito da história que pertence a
    outra tarefa (feita ou pendente) NÃO reprova esta entrega: cite-o no
    `resumo` como observação e não o ponha em `itens`. O mesmo vale para o
    que depende de entrega de OUTRA história ainda não feita (uma rota, uma
    tela, um dado que ela cria): é observação, nunca reprovação.

    Liste em `itens` TODAS as lacunas desta tarefa que você achar nesta volta,
    de uma vez — nunca uma por volta: cada volta é uma correção paga e um passo
    do teto do ciclo. Antes de emitir, faça a VARREDURA POR REGRA: percorra
    cada regra de negócio acima e cada critério da tarefa, um por um, e para
    cada um diga a si mesmo onde está a prova (arquivo e teste) ou que ela
    falta. Só emita depois de passar por TODAS; lacuna que já estava na
    entrega e aparece só na volta seguinte é uma volta paga a mais.
    #{secao_do_ambiente_limpo()}#{secao_da_forma(regras, task)}#{secao_do_ponto_de_entrada(task)}#{secao_do_contrato(contrato)}
    """
  end

  # AT-479 (RN-765): a regra dizia "a contagem e o histórico
  # de cliques de TODOS os links" e o QA aprovou `{totalCliques}`, sem a
  # contagem POR link. Quando o texto da regra quantifica por item ("por X",
  # "cada", "de todos os"), o recorte pede a conferência da FORMA da resposta.
  # Só um lembrete de leitura: não muda a régua do veredito (a regra continua
  # sendo a que reprova). A recusa que não nomeia o campo é OBSERVAÇÃO.
  @quantificador ~r/\b(de tod[oa]s [oa]s|cada|por (?!exemplo|padr[aã]o|isso|meio|favor|causa|vez|cento|enquanto|fim|ora)\p{L}+)/iu

  defp secao_da_forma(regras, task) do
    textos = [Map.get(task, "description", "") | Enum.map(regras, &Map.get(&1, :content, ""))]

    if Enum.any?(textos, &(is_binary(&1) and Regex.match?(@quantificador, &1))),
      do: """

      Forma da resposta: há regra que fala POR item ("por X", "cada", "de
      todos os"). Confira no código/teste que a resposta traz o valor de CADA
      item (ex.: uma contagem por link), não só o total — total sozinho não
      cobre a regra. E quando uma entrada é recusada, veja se a mensagem nomeia
      o campo recusado; se não nomeia, cite no `resumo` como observação (não
      vai para `itens`, salvo regra que o exija).
      """,
      else: ""
  end

  # AT-483 (RN-813): no TP-01 o `server.ts` nunca chamava a migração e uma rota
  # `/:code` sombreava `GET /links` — os 53 testes passavam porque cada um monta
  # o próprio app. Quando a tarefa toca o ponto de entrada, a fiação ou o README
  # de execução, o recorte exige evidência de que o entrypoint REAL sobe e
  # responde; a ausência dela vai para `itens`.
  @ponto_de_entrada ~r/(server\.[jt]s|main\.[jt]s|index\.[jt]s|entrypoint|ponto de entrada|app\.listen|\bREADME|npm start|pnpm start|\bstart\b|\bfia[cç][aã]o|\bmigra[cç][aã]o|\brotas?\b|\broutes?\b)/iu

  defp secao_do_ponto_de_entrada(task) do
    texto = "#{Map.get(task, "title", "")} #{Map.get(task, "description", "")}"

    if Regex.match?(@ponto_de_entrada, texto),
      do: """

      Ponto de entrada: esta tarefa toca o entrypoint, a fiação (rotas,
      migração, registro) ou o README de execução. Exija evidência de que o
      ponto de entrada REAL sobe — o `start`/`main` do projeto rodado, ou um
      teste que importe o entrypoint real (não um app montado no próprio
      teste) — e responde numa rota ou comando. Teste que monta o próprio
      banco e o próprio app não prova isso. Sem essa evidência, ponha a lacuna
      em `itens`.

      O que CONTA como evidência no ambiente do dev: subir o processo do
      entrypoint (o `start`/`main`) na pasta do projeto, rodar o script no
      container do projeto, bater numa rota do processo de pé. O que NÃO cabe
      ali: construir imagem Docker, `docker compose`, rede externa — o
      container do projeto não tem Docker nem saída garantida. Exigência desse
      segundo tipo NUNCA vai para `itens`: cite-a no `resumo` como observação.
      """,
      else: ""
  end

  # AT-496 (RN-817): no TP-01 a suíte travava num clone limpo (um teste matava
  # o `npm` e o `node` neto ficava na 3000), e o QA viu exit 0 porque o teste
  # se PULAVA com a porta ocupada por um servidor órfão de rodada anterior. O
  # recorte pede estado limpo antes da suíte, teste de processo que encerre o
  # GRUPO, e teste pulado por ambiente como observação. É instrução e não passo
  # do harness: quem roda a suíte é o próprio QA pelo `terminal`, que já passa
  # pela política e pelo roteamento de container dos três modos.
  defp secao_do_ambiente_limpo do
    """

    Ambiente limpo: antes de rodar a suíte, encerre o que o PRÓPRIO projeto
    deixou de pé em rodadas anteriores (servidor do `start` ainda escutando
    numa porta do projeto) — só processos desta pasta, ex.: `pkill -f` com o
    caminho do projeto; nunca processo de fora dele. Teste que sobe processo
    deve encerrar o GRUPO (ou subir `node` direto, não via `npm`, que deixa o
    neto vivo); se não encerra, a suíte trava num clone limpo — é lacuna em
    `itens`. Teste que se PULOU por ambiente (porta ocupada, ferramenta
    ausente) não conta como verde: cite-o no `resumo` como observação.
    """
  end

  # AT-462 (RN-786): o contrato do Arquiteto é a fonte da INTERFACE (nome de
  # rota, assinatura). O dev o segue; divergência com a história é do
  # Arquiteto/usuário resolverem, não do dev.
  defp secao_do_contrato(%{"expoe" => [_ | _] = itens} = c) do
    """

    Contrato do módulo #{Map.get(c, "modulo", "")} (declarado pelo Arquiteto — a fonte da INTERFACE):
    #{lista(Enum.map(itens, &item_do_contrato/1))}

    Quando a história e o contrato divergem num nome de interface (rota,
    função, evento), a entrega que segue o CONTRATO não é reprovada por isso:
    nomeie a DIVERGÊNCIA no `resumo` (história diz X, contrato diz Y) como
    observação para o usuário e o Arquiteto, fora de `itens`.
    """
  end

  defp secao_do_contrato(_), do: ""

  defp item_do_contrato(i),
    do:
      "#{Map.get(i, "tipo", "")}: #{Map.get(i, "assinatura", "")} — #{Map.get(i, "descricao", "")}"

  defp aberta(t),
    do:
      "#{Map.get(t, "title", "")} (#{Map.get(t, "status", "?")}, história: #{Map.get(t, "storyTitle", "?")})"

  defp corte(abertas, total) when total > length(abertas),
    do: "\n(mostrando #{length(abertas)} de #{total})"

  defp corte(_, _), do: ""

  defp irma(t), do: "#{Map.get(t, "title", "")} (#{Map.get(t, "status", "?")})"

  defp lista([]), do: "(nenhuma)"
  defp lista(itens), do: Enum.map_join(itens, "\n", &("- " <> to_string(&1)))
end
