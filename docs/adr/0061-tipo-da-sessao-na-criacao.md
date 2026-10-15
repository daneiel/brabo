# ADR 0061 — O tipo da sessão é dado da criação, e a execução continua sendo evento

- **Status:** aceito
- **Data:** 2026-08-09
- **Contexto anterior:** [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md)
  (o estado do dev agent é derivado de evento — a mesma família de decisão),
  [ADR 0046](0046-promocao-de-story-com-autoridade-do-usuario.md) (default novo
  + backfill dirigido, o formato de migração reusado aqui)

## Contexto

Toda sessão nascia igual. Para chegar ao Criativo — o agente que conduz a
ideação e é a porta de entrada da cadeia que produz — era preciso abrir a
sessão primeiro e **descobrir depois** um botão na barra de topo. O usuário
relatou exatamente isso: *"o processo de ter que selecionar o botão acima para
iniciar o criativo não ficou claro o suficiente; faça com que exista diferença
entre o tipo de sessão apenas consultiva e uma para iniciar de fato o
criativo"*. Junto vieram dois pedidos da mesma navegação: poder **nomear** a
sessão sem perder a hashtag pela qual ela é apontada, e ter um **caminho de
volta** ao dashboard — `SessionPage` não importava `Link` nem `useNavigate`, e
entrar numa sessão era um beco sem saída.

O primeiro pedido é o que carrega risco de arquitetura, e não é o campo novo: é
que o produto **já sabia** distinguir uma sessão que executa. Sabia por
derivação — `findActiveExecutionSession` procura a sessão `active` que carrega
o evento `execution.activated`, e é isso que faz reativar cair na sessão onde
os dev agents já estão, em vez de abrir uma órfã a cada clique (achado #11 do
primeiro dogfooding). Gravar um tipo na tabela cria uma **segunda fonte** para
uma pergunta parecida. Duas fontes sobre a mesma coisa acabam divergindo, e a
divergência aqui não seria cosmética: ela decide onde os dev agents escrevem.

Havia a saída de não gravar nada e continuar derivando tudo do log. Ela não
serve, e o motivo é temporal: a intenção existe **antes** de qualquer evento —
no clique que abre a sessão — e é justamente o instante em que o produto
precisava perguntar. Uma sessão criativa que ninguém ativou ainda não tem
evento nenhum para derivar, e é ela que o pedido do usuário descreve.

## Decisão

**As duas fontes existem, e respondem perguntas diferentes.**

`sessions.kind` (`consultiva | criativa`) classifica a **intenção de criação**.
É escolhido no corpo de `POST /projects/:projectId/sessions`, que até aqui não
recebia corpo nenhum, e é **imutável** — não há rota que o troque. O evento
`execution.activated` continua classificando o **estado de execução**, e
`findActiveExecutionSession` **não** passou a olhar `kind`: uma sessão criativa
que nunca ativou execução não é a sessão de execução vigente.

O que impede as duas de escreverem uma sobre a outra é uma regra só, e é ela a
decisão de verdade: **`execution.activated` numa sessão `consultiva` é erro
(409), não conversão silenciosa**. Deixar o evento promover o tipo seria
exatamente as duas fontes disputando a mesma linha. A trava mora no **funil** —
`AppendSessionEventUseCase` — e não no `ActivateExecutionUseCase`: os dois
caminhos que gravam evento (a rota do usuário e a `/internal/*` do engine)
passam por ele, e travar no caso de uso deixaria o outro aberto. Ela roda antes
do `incrementSeq`, para que tentativa recusada não consuma `seq`.

O tipo é **obrigatório** em todos os pontos de criação, inclusive nos internos:
o método do repositório e o caso de uso exigem o campo. Um parâmetro opcional
faria os cinco chamadores herdarem o default calados, que é o defeito de origem
com outro nome. Os quatro caminhos internos (provisionar, adotar, ativar
execução, seed) declaram `criativa`, porque a próxima coisa que essas sessões
recebem é o `execution.activated`.

O **default da coluna** é `consultiva` — o tipo que pode menos. Ele não existe
para conveniência: existe para que linha vinda de caminho que não passa pela
rota não ganhe o direito de executar. O **backfill** da migração vai na direção
oposta, e é dirigido: no instante em que ela roda, toda sessão é anterior à
distinção, e algumas são as sessões em que os dev agents estão trabalhando
agora — acordar `consultiva`, elas recusariam a reativação de um projeto em
andamento sem que ninguém tivesse decidido nada. É o formato do ADR 0046,
chegando à mesma conclusão pelo mesmo argumento.

**O nome é rótulo, não fato.** `sessions.name` é opcional e trocável por
`PATCH /projects/:projectId/sessions/:sessionId` (papel `developer`, o mesmo
que abre a sessão). Renomear **não** vira evento: o log é o que a sessão viveu,
e N renomeações empurrariam para fora da cauda de 200 exatamente o que
interessa. O rótulo é composto — nome **e** hashtag —, porque a hashtag é o que
se cola numa URL e nome escolhido por pessoa não é único; sem nome, degrada
para a hashtag sozinha. Branco conta como ausência, e `null` no corpo é o
caminho de desfazer.

## Consequências

**O que melhora.** A escolha acontece onde ela é feita, com as duas
explicações à vista, e a sessão consultiva deixa de oferecer o que não faz — o
botão "Iniciar ideação" só existe na criativa. A sessão ganha nome e saída. E o
`Disclosure` do design system ganhou seu primeiro call site real: o colapso do
"Log de eventos", que era um `button` com `−`/`+` de texto, sem `aria-controls`
e sem região nomeada.

**O que fica pior, e é aceito.** A pergunta "esta sessão executa?" agora tem
dois lugares para procurar, e nenhum comentário substitui essa memória: quem
mudar `findActiveExecutionSession` para olhar `kind` fará o produto passar a
mandar dev agents para sessões que ninguém ativou. O teste que morre nesse caso
é explícito, e está escrito para morrer *por esse motivo*.

**O tipo é imutável, e isso vai incomodar.** Quem abrir uma consultiva e mudar
de ideia abre outra sessão. É deliberado: um `changeKind` transformaria a
intenção em estado, e devolveria de uma vez o problema que este ADR existe para
não criar. Se o incômodo se provar real, a saída não é destravar o campo — é
uma ação explícita de "promover", que copia o contexto para uma sessão nova e
deixa rastro de que houve promoção.

**Um teto de nome, e nada de unicidade.** Nome é limitado a 80 caracteres
porque o rótulo divide uma barra de largura fixa com a hashtag. Não há
`unique`: duas sessões podem se chamar igual, e é a hashtag que as distingue —
exigir unicidade seria pedir ao usuário que administrasse um espaço de nomes
que ele não pediu.

**Fora de escopo, declarado.** A sessão criativa **não** ativa o Criativo
sozinha: continua sendo um clique, agora só onde faz sentido. Ativar por conta
própria seria efeito ao abrir uma tela, e o produto não faz isso. As abas Chat
e Criativo, que a FASE 24 vai construir sobre `kind`, também não entram aqui.
