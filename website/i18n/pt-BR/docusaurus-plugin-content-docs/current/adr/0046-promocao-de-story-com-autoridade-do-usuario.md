# 0046 — Promoção de história com autoridade do usuário

## Contexto

O achado #13 do dogfooding, verbatim de
`docs/missions/dogfooding-mission.md:669`:

> Não existe "promover a ready": a promoção é automática na criação.
> `TransitionStoryUseCase` valida e emite `backlog.story_transitioned`, mas
> **não está ligado a rota nenhuma** — é código morto. A aba Backlog é
> somente leitura.

Ele nasceu classificado **P2** e virou um dos três P1 que a Fase 12 mata, por
uma razão que só ficou clara depois da corrida: dos três achados, este é o
único que não é sobre conveniência. Adoção e reagendamento eram atrito — o
humano fazia à mão o que a máquina deveria fazer. Aqui é o contrário: a máquina
fazia sozinha o que o humano deveria decidir, e `CLAUDE.md` diz, na primeira
linha do que o produto é, que a autoridade final é do usuário. Uma história
virando `ready` na criação significa que o PO — um agente de LLM — decide
sozinho o que entra na fila de trabalho dos dev agents.

Três fatos verificados no código, ANTES de desenhar, moldaram a decisão:

1. **`story.status` é o portão do claim.** `TaskRepository.claimNext` filtra por
   `s.status = 'ready' AND s.module_ids ? module AND t.status = 'todo' AND
   t.blocked = false`. Nada além do status da história separa "trabalho
   proposto" de "trabalho pegável".
2. **A validação estava duplicada e assimétrica.** A criação chamava
   `canBecomeReady`; a transição chamava `assertReady` + `assertModulesResolved`.
   Duas portas para o mesmo estado, com fechaduras diferentes.
3. **`TransitionStoryUseCase` já fazia tudo** — validava, emitia o evento e,
   desde a Fase 12b, escrevia uma linha de outbox `task.became_claimable` por
   tarefa liberada. Faltava um chamador.

## Decisão

**`proposed_ready` é um booleano, não um valor novo no enum de status.**
Foi a primeira tentativa descartada. Um `story_status = 'proposed'` seria mais
expressivo, mas o enum é literalmente o portão do claim (fato 1): acrescentar
um valor obrigaria a revisitar toda consulta que compara status, e um ponto
esquecido não daria erro — daria uma história pegável cedo demais, em silêncio.
O booleano diz o que a coisa é: uma PROPOSTA sobre uma história que continua
`draft`. O estado da máquina não muda porque nada mudou de fato; o que existe é
uma pendência endereçada ao usuário.

**Promover reusa `TransitionStoryUseCase`; não se escreveu transição nova.**
O código morto do achado #13 volta a ser chamado, e com ele vem de graça o
reagendamento da 12b: promover escreve as linhas de outbox que acordam os dev
agents ociosos do módulo. Uma promoção "própria" teria que reimplementar isso —
e a primeira versão que esquecesse deixaria o lote de tarefas pegável sem
ninguém avisado, com o agente descobrindo por acaso no próximo evento não
relacionado.

`execute` ganhou um parâmetro `actor` opcional. O evento `backlog.story_transitioned`
é imutável e é o que a auditoria lê; gravar `agent/po` numa promoção que foi
decisão do usuário apagaria justamente o passo humano que esta fase devolve.

**A validação foi unificada em `assertPromotable` ANTES de tornar o gatilho
configurável**, e essa ordem não é detalhe. Enquanto os dois caminhos tivessem
fechaduras diferentes, "promover pela UI" e "promover na criação" seriam regras
distintas com o mesmo nome, e o modo `manual` seria mais rigoroso ou mais frouxo
que o `auto` por acidente de implementação. O teste de simetria em
`story-promotion.spec.ts` é o que mantém a propriedade: **o modo muda QUEM
dispara, nunca O QUE é validado.**

Detalhe que quase quebrou o modo `auto` em silêncio: `moduleIds` vazio PASSA na
validação, e tem de passar. Na criação a história ainda não tem módulos — quem
os atribui é o Arquiteto, depois. Ligar `assertPromotable` ao caminho de criação
sem preservar isso faria o modo `auto` nunca mais promover nada, sem erro
nenhum.

**O backfill é dirigido, não cego.** A coluna nasce `manual` (o default novo) e
a mesma migração move todos os projetos existentes para `auto`. É o oposto do
backfill da RN-046, que pôde ser cego porque adoção não existia antes dele.
Aqui o comportamento existia e estava em uso: um projeto em andamento não pode
parar de produzir por causa de um deploy. O default novo vale para quem vier
depois.

**A recusa espelha a devolução de gate ao dev, e inverte a ordem do rearm.**
O motivo vira mensagem FIXADA na sessão do PO — o primeiro `pinned` fora do
system prompt num agente conversacional —, com a mesma frase de precedência que
o `correction_message/1` do dev agent carrega desde o ADR 0020. Fixada porque a
recusa é pendência, não fala: compactada pelo `ContextManager`, o PO reproporia
a mesma história com o mesmo defeito.

A gravação vem ANTES da chamada ao engine, ao contrário do `RearmDevAgentUseCase`.
Lá o evento (`dev.rearmed`) afirma algo SOBRE O ENGINE, e gravá-lo antes seria
mentira no log se o engine recusasse. Aqui o evento afirma algo sobre o
USUÁRIO — ele recusou, e isso é verdade tenha ou não um PO de pé para ouvir.
Perder a decisão porque o processo do agente morreu num restart devolveria o
usuário ao começo sem razão. Por isso o engine é best-effort, e a rota interna
responde **404** com o PO morto em vez de estourar `:noproc`.

**A mensagem de devolução diz o que o PO PODE fazer, e isso é uma limitação
assumida.** Não existe ferramenta de editar história — só `create_story`. A
mensagem manda criar a versão corrigida, ou perguntar ao usuário se o motivo não
estiver claro. Mandar "corrija a história" seria pedir o impossível, e um modelo
diante de instrução impossível inventa ferramenta ou repete a chamada até
esgotar o loop — foi assim que o dev agent queimou três correções seguidas no
aceite do ADR 0020.

**Promover em lote não é all-or-nothing.** Cada história é sua própria
transação; a que falhar volta em `failed` com o motivo, num 201. O caso real é
concreto: entre a proposta do PO e a decisão do usuário, um módulo pode ter
saído do `module_map`. Abortar o lote inteiro por causa disso desfaria a revisão
que o usuário acabou de fazer nas outras.

## Consequências

O default mudou, e isso é **quebra de comportamento** para quem cria projeto
novo: o backlog não anda sozinho até alguém promover. Está no CHANGELOG como
incompatível. Projeto existente não sente nada.

A UI do Backlog deixou de ser somente leitura. São as duas únicas escritas de
backlog que pertencem ao usuário e não a um agente — todo o resto continua
entrando pelas rotas `/internal/*`.

`POST /internal/sessions/:id/agent/revise` é o primeiro caminho api→engine que
devolve trabalho a um agente CONVERSACIONAL. Até aqui as devoluções (gate → dev)
eram internas ao engine, em processo. A rota herdou do `rearm` o formato e a
checagem de existência antes de chamar.

Fica para depois, como backlog e não como dívida escondida:

- **Ferramenta de editar história.** Enquanto não existir, o loop de recusa
  fecha por recriação, e a história recusada permanece em `draft` com o motivo
  gravado. É auditável, mas deixa lixo no backlog.
- **Promoção por lote com revisão lado a lado.** Hoje o lote é seleção múltipla
  com as histórias expandidas na própria fila; uma tela de revisão dedicada faz
  sentido quando o volume crescer.
- **Rebaixar uma história promovida por engano.** `assertTransition` permite
  `ready → draft` (é como o `story_demoted` da RN-012 opera), mas não há rota do
  usuário para isso. O caminho hoje é a recusa ANTES de promover.
