# 0167 — O modo automático libera o escopo de caminho, e só ele

## Status

**Accepted.** Decidido pelo dono do produto em 2026-09-26 (AT-226), entre três
opções: *"com o modo automático ligado, o agente executa qualquer comando de
terminal sem aprovação, inclusive fora da pasta do projeto"*. Revê, SÓ para
agente em modo automático, o teto de escopo de caminho do
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md).
Não edita o 0055 nem o [ADR 0102](0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md)
(o teto de efeito externo/comando privilegiado, RN-418), que seguem valendo
inteiros. A regra que nasce daqui é a
[RN-603](../business-rules/autenticacao.md#rn-603); ela revê a
[RN-153](../business-rules/autenticacao.md#rn-153) e a
[RN-154](../business-rules/autenticacao.md#rn-154).

## Context

O "modo automático" ([RN-153](../business-rules/autenticacao.md#rn-153)) é a
curinga `"*"` em `agent_autonomy`: autonomia para qualquer tipo de ação de um
agente. Ele foi desenhado para NÃO furar teto nenhum de `decide()` — os tetos
agiam sobre `current.policy === 'auto_approve'`, sem saber de onde a
permissividade veio ([RN-154](../business-rules/autenticacao.md#rn-154)).

Um desses tetos é o de ESCOPO DE CAMINHO (ADR 0055): comando de terminal que
toca caminho fora da pasta do projeto nunca é auto-aprovável. Medido no banco
do dono em 2026-09-26, projeto `exp001` (modo `mounted`, container de pé): com
o modo automático ligado nos dev agents, **51** comandos de terminal ainda
pediram aprovação, e **47** só porque citavam `/work` ou `/tmp`. O dev agent
roda DENTRO do container, onde a pasta do projeto é `/work`, e o escopo
compara o comando com a raiz do HOST — então tudo o que o agente escreve do
jeito certo para onde ele roda vira "fora da pasta do projeto". Nenhum dos 51
era `git push`, PR, deploy ou `sudo`.

Havia um segundo pedido pelo mesmo motivo, sem o nome de escopo: o comando
COMPOSTO (`cd /work && npm test`) com um segmento sem regra em
`permissions.json` recebe um `require_approval` SINTETIZADO pelo arquivo — que
existe para impedir um `allow` parcial de promover o comando inteiro — e esse
veredito sobrescrevia o `auto_approve` da autonomia.

O dono pediu: *"uma vez que o usuário apertar o botão modo automático, aquele
agente deve entender que pode executar qualquer comando… só deve novamente
pedir para aprovar quando o usuário definir os agentes como manual
novamente"*.

## Decision

1. **`decide()` passa a saber a ORIGEM da autonomia.** O repositório
   (`AgentAutonomyRepository.resolve`) devolve o modo resolvido E se ele veio
   da regra específica do tipo ou da curinga. A precedência específica >
   curinga continua morando lá, uma vez só — `findMode` virou leitura de
   `resolve`, não uma segunda régua. `decide()` continua pura: recebe
   `ctx.autonomyOrigin`, e origem ausente vale como `'especifica'` (quem não a
   informa mantém o veredito de antes).
2. **Modo automático é exatamente: curinga, resolvida como `auto_approve`.**
   `"*": require_approval` (o toggle desligado) e `"*": deny` não ganham poder
   nenhum. Uma regra específica do tipo (`terminal: require_approval`) vence a
   curinga no repositório e chega com origem `'especifica'` — o modo
   automático não a atropela.
3. **Em modo automático, o teto de escopo de caminho não se aplica.** Nem o
   `require_approval` que o comando composto sintetiza por segmento sem regra:
   ele é o arquivo SEM opinião, e arquivo sem opinião nunca rebaixa um estágio
   anterior. Um `ask` ESCRITO no `permissions.json` continua valendo — é regra
   do usuário, e regra explícita vence a curinga, como no repositório.
4. **Todo o resto fica byte a byte.** `deny` (do `permissions.json`, dos
   padrões embutidos ou de autonomia específica) continua vencendo; o teto de
   efeito externo/comando privilegiado (`git push`, PR, deploy, `sudo`/`doas`,
   RN-418) roda ANTES do de escopo e não olha a origem; merge em branch
   protegida, `instruction_patch`, `parallelize`/`raise_max_parallel` e
   `container_remove` seguem nunca auto-aprováveis.
5. **A tela diz, antes do clique, o que o botão libera e o que continua
   pedindo.** A nota do `ApprovalCard` vale nas duas variantes (chat e fila de
   Aprovações), e o card do agente mostra uma frase sob o toggle — só quando a
   CURINGA está ligada, porque o toggle sobre o tipo representativo grava uma
   regra específica, que não libera o escopo.

## Consequences

- Um agente em modo automático pode ler e escrever fora da pasta do projeto
  sem perguntar. É o preço escolhido: o achado U (o agente lendo o código da
  plataforma que o executa, ADR 0055) volta a ser possível PARA ESSE AGENTE,
  por decisão explícita do usuário que ligou o modo. A contenção que sobra é a
  do lugar onde o comando roda — o mount namespace do container
  (`container`/`mounted`, ADR 0134) ou a máquina do usuário (`runner`) — mais
  o `deny` e os tetos de efeito.
- Voltar o toggle do card do agente para "manual" regrava a curinga como
  `require_approval` e restaura o teto de escopo na próxima proposta.
- O toggle do card, quando NÃO há curinga gravada, continua editando o tipo
  representativo (`autonomyActionTypeFor`) — uma regra específica. Ligá-lo por
  ali não é modo automático e não libera o escopo; a tela não diz que libera.
- `decide()` deixa de ser cega à origem da autonomia, que era a prova por
  construção da RN-154. A prova continua valendo para todos os tetos menos o
  de escopo, e é travada por teste: cada um deles com a curinga ligada segue
  `require_approval`.

## Alternatives considered

- **Traduzir `/work` para a raiz do host antes do escopo.** Resolveria os 47
  do `exp001`, mas não o `/tmp` nem o que o dono pediu ("qualquer comando").
  E a tradução mora no engine, depois da decisão, de propósito (ADR 0134).
- **Liberar o escopo para toda autonomia `auto_approve`, específica ou não.**
  Recusada: `terminal: auto_approve` por tipo existe desde a Fase 8d com o
  escopo por cima, e mudar o sentido dela sem ninguém ter pedido reabriria o
  achado U em projetos que nunca ligaram o modo automático.
- **Deixar o `ask` escrito no arquivo ser ignorado também.** Recusada: seria o
  modo automático atropelando regra explícita do usuário, o inverso da
  precedência que o repositório já aplica.
