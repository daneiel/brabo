# 0157 — O teto de auto-movimento no upsert de workspace, e a auto-promoção que era brecha

## Status

**Accepted.** É o TERCEIRO da linha aberta pelo
[ADR 0127](0127-tetos-de-rebaixamento-em-project-members.md) e continuada pelo
[ADR 0156](0156-teto-de-auto-rebaixamento-na-remocao.md). Fecha o último
movimento que os dois deixaram declarado por escrito, e **revisa** uma frase do
0127: a auto-PROMOÇÃO, que ele registrou nas Consequences como capacidade que
ficava, passa a ser recusada. ADR aceito não se edita — este o referencia e diz
o que mudou. Corresponde ao `BRB-002`, P1 de segurança do registro do
mantenedor.

## Context

Os dois ADRs anteriores fecharam as três portas de `project_members` — as duas
de escrita e a de remoção — e cada um deles apontou, com todas as letras, para o
que ficava aberto. O 0127:

> rebaixar o `owner` do workspace **no workspace**. O teto 1 é sobre
> `project_members`. `POST workspaces/:workspaceId/members` continua um upsert
> sem teto nenhum — mesma classe de defeito, escopo acima, não endereçado aqui.

E o 0156, reafirmando:

> **Estender o teto ao workspace.** `POST workspaces/:workspaceId/members` é um
> upsert sem teto nenhum, como o ADR 0127 já declarava (…) Escopo diferente,
> decisão separada.

**O defeito, medido.** `AddWorkspaceMemberUseCase` era um passa-adiante de doze
linhas: `execute(workspaceId, userId, role)` chamando `workspaces.addMember`.
**Não recebia o ator**, e o controller
(`@Post(':workspaceId/members')`, `@RequireRole('owner')`) chamava com o corpo
puro, sem `@CurrentUser()` — não havia com o que aplicar teto nenhum, do mesmo
jeito que não havia na remoção antes do 0156.

É a mesma classe de defeito um escopo ACIMA, e é mais grave por duas razões que
não existem no projeto:

1. **não há nível acima para segurar a queda.** No projeto, rebaixar-se derruba
   o efetivo para o papel de workspace, que muitas vezes o segura. No workspace
   o papel é o papel: um `owner` que se grava `viewer` perde o workspace
   inteiro, e com ele todos os projetos, o gasto de LLM que é dele por
   [RN-060](../business-rules/custo.md#rn-060), e a própria capacidade de
   convidar quem o reponha;
2. **não existe rota de remoção de membro para desfazer por outro caminho.**
   `WorkspacesController` não tem `@Delete` de membro — o 0156 já tinha medido
   isso e usado como argumento para não estender o teto naquela PR. Desfazer é
   ESTA mesma rota, que pede o `owner` recém-abandonado. Não há caminho de volta
   pela tela, nem pela api.

**A segunda metade: a auto-promoção.** O ADR 0127 escreveu, na lista do que
seguia possível:

> **auto-PROMOÇÃO.** Um `maintainer` pode se gravar como `owner` do projeto. Já
> era possível antes deste ADR e continua sendo; os tetos são sobre descer, e
> abrir a questão de subir aqui teria mudado, de passagem, uma capacidade que
> ninguém pediu para mudar.

Havia teste fixando isso — *"subir o próprio papel não é rebaixamento e continua
passando"* —, com um `maintainer` de workspace se gravando `owner` do projeto.
A decisão de não abrir a questão naquela PR estava certa pelo processo, e a
resposta, agora que ela está aberta, é que **é brecha**. As duas metades são o
mesmo movimento — uma pessoa decidindo sozinha qual autoridade tem —, e a de
cima é a única das duas que **escala privilégio**: o 0127 pôde dizer que os
tetos dele não eram sobre escalação ("ninguém ganha papel que não tinha"), e
sobre a auto-promoção isso é falso. Um `maintainer` vira `owner` de projeto sem
que ninguém o promova, e num workspace com projetos sensíveis é a diferença
entre restringir e ser irrestringível.

## Decision

**1. O upsert de workspace recebe o ator e recusa o auto-movimento.**
`AddWorkspaceMemberUseCase.execute` vira
`(workspaceId, atorId, alvoId, papel)` — a mesma ordem que
`AddProjectMemberUseCase` tem desde o 0127 e que `RemoveProjectMemberUseCase`
ganhou no 0156 —, o controller passa `@CurrentUser()`, e mudar o PRÓPRIO papel
ali é 403.

**2. O teto NÃO conta owners.** Recusar só quando o chamador for o último dono
seria a regra "segura" óbvia, e ela é recusada pelo critério literal do ADR
0127: *"se enuncia numa cláusula, não tem número para envelhecer"*. Uma
contagem envelhece de três maneiras — ela introduz uma leitura a mais que pode
sair de fase com a escrita; ela tem de decidir o que fazer quando o segundo dono
é uma conta de serviço ou uma pessoa que saiu da empresa, que a api não sabe
distinguir; e ela transforma a resposta da rota em algo que depende do estado de
OUTRAS linhas, então a mesma chamada com o mesmo corpo passa hoje e recusa
amanhã sem que nada do que o chamador controla tenha mudado. Quem quiser sair do
próprio papel pede a outro `owner`, que é o mesmo desfecho que o teto 2 já
produzia no projeto.

E há um argumento mais forte que a estética: **a cláusula já produz o invariante
que a contagem existiria para garantir.** Um workspace nunca fica sem `owner`,
porque a rota pede `owner` e o único ator capaz de tirar o último dono seria ele
mesmo — que é exatamente o movimento recusado. O número não precisa ser contado
porque a forma da regra o torna inalcançável.

**3. O teto 1 NÃO tem par neste escopo, e a ausência é decisão.** Foi
considerado de verdade, porque aqui — diferente da remoção do 0156 — o
movimento EXISTE: um `owner` pode rebaixar outro `owner`. A recusa vem de o
teto 1 ser uma regra sobre **inversão de hierarquia**, e a inversão não ser
possível neste escopo:

- no projeto, `projectRole ?? workspaceRole` faz a linha de projeto SOBREPOR a
  de workspace ([RN-471](../business-rules.md#rn-471)), então um `maintainer`
  alcança quem está ACIMA dele. Foi assim que o 0127 descreveu o dano: *"o dono
  perde o próprio projeto (…) restaurar exige `maintainer`, que o dono acabou de
  perder naquele escopo"*. Quem agia estava ABAIXO de quem sofria;
- no workspace isso não acontece. `@RequireRole('owner')` é o topo do
  `ROLE_ORDER`, então quem chama a rota nunca está abaixo de ninguém que ela
  alcança. A precondição do teto 1 está ausente — não é simetria esquecida, é
  regra sem sujeito.

E o custo de pôr o par mesmo assim seria alto e irreversível: somado ao teto do
ponto 1 e à ausência de rota de remoção, `owner` viraria um **estado
absorvente** — ninguém sairia dele por HTTP nunca, nem por vontade própria nem
pela mão de outro dono. Offboarding de quem deixa a empresa, rotação de
propriedade e correção de um convite errado passariam a exigir escrita direta no
banco. Isso é a classe de estado que o ADR 0127 nasceu para eliminar, montada de
novo com o sinal trocado.

Rebaixar outro `owner`, portanto, FICA — e é reversível pela mesma rota, por
qualquer dono restante, o que o movimento do projeto não era.

**4. A auto-promoção fecha, nas DUAS rotas de associação.** O teto 2 deixa de
ser "ninguém rebaixa a si mesmo" e passa a ser "ninguém mexe no próprio papel",
nos dois sentidos, no projeto e no workspace. Reescrever o MESMO papel continua
passando: upsert idempotente não é movimento, e recusá-lo quebraria o
`seed.ts`, que reescreve papéis de propósito.

**5. A régua não é copiada: a comparação vira UM classificador.** O módulo
`domain/iam/tetos-de-rebaixamento.ts` ganha
`autoMovimentoDoProprioPapel`, que devolve o SENTIDO
(`'rebaixamento' | 'promocao' | null`) em vez de um booleano. Foi ele, e não um
`ehAutoPromocao` separado, porque **quem chama precisa do sentido**: a decisão
do ponto 6 exige mensagens diferentes, e dois predicados booleanos fariam cada
caso de uso perguntar duas vezes a mesma comparação para descobrir qual das duas
respondeu. `ehAutoRebaixamento` **continua existindo** e passa a ser uma leitura
do classificador (`=== 'rebaixamento'`), byte a byte no comportamento.

Ela sobrevive por um motivo de comportamento e não de compatibilidade: quem
delega a ela é `remocaoEhAutoRebaixamento`, e a REMOÇÃO só enxerga a metade de
baixo. Alargá-la faria a remoção recusar também a auto-promoção — e tirar a
própria linha de projeto que restringia alguém é justamente como se desfaz a
restrição que o teto 1 impede de criar, o movimento benigno que o ponto 3 do ADR
0156 protegeu explicitamente. Unificar tudo teria mudado, de passagem, uma porta
que este ADR não abriu.

**6. As mensagens são próprias por SENTIDO e por ESCOPO.** São quatro, e
nenhuma serve para duas coisas: quem tentou se promover não recebe a frase de
rebaixamento (não foi o que fez), e quem esbarra no teto do workspace não é
mandado falar com um `maintainer` — lá o papel que desfaz é `owner`. É a mesma
disciplina do ponto 5 do ADR 0156 e da [RN-470](../business-rules/custo.md#rn-470):
não colapsar dois estados por eles compartilharem um desfecho.

**7. O papel do ator vem do repositório, não do
`ResolveEffectiveRoleUseCase`.** É o inverso da escolha do 0156, pela mesma
razão que ela deu ("nenhuma dependência a mais por uma leitura"): nos casos de
uso de projeto o `ResolveEffectiveRoleUseCase` entra para o papel do ator não
virar uma segunda composição de `projectRole ?? workspaceRole` escrita à mão;
no workspace **não há composição a proteger** — `forWorkspace` É
`workspaces.findMemberRole` —, e este caso de uso já tem o repositório na mão,
porque é com ele que escreve.

**8. 403, no caso de uso, nunca no `RolesGuard`.** Sem novidade: o guard
autoriza o CHAMADOR contra o `@RequireRole` da rota e não vê corpo (`dto.role`)
nem alvo (`dto.userId`), e este teto é sobre a relação ator↔alvo. O raciocínio
inteiro está no ADR 0127 e não se repete aqui.

**9. A promoção é aplicada mesmo sendo inalcançável por HTTP nesta rota.** Com
`@RequireRole('owner')`, o ator já está no topo e não há para onde subir — a
metade de cima do teto, no escopo de workspace, é mecanismo que hoje não
dispara. Ela entra assim mesmo, e testada, pelo motivo que o teto 2 sempre teve
para não ter limiar: o caso de uso não presume o guard, e é ele que fica certo
no dia em que a rota mudar de mínimo. É o mesmo desenho da recusa por capacidade
do [RN-514](../business-rules.md#rn-514), implementada e testada antes de ter
disparo.

## O que este ADR recusa explicitamente

- **Contar owners.** Ver o ponto 2. Nem "só o último", nem "só se não sobrar
  outro dono ativo". A cláusula não tem número para envelhecer, e já produz o
  invariante de nunca haver zero owners.
- **Um teto de `owner` do workspace neste escopo.** Ver o ponto 3. Não é
  simetria esquecida nem descarte por reflexo: é regra sobre inversão de
  hierarquia numa rota onde a inversão é impossível, e pô-la faria de `owner`
  um estado do qual ninguém sai por HTTP.
- **Uma rota de remoção de membro de workspace.** A ausência dela é parte do
  contexto deste ADR (é por ela que o auto-rebaixamento não tem volta), e
  criá-la seria abrir uma porta nova enquanto se fecha outra — e a porta nova
  nasceria precisando do mesmo teto, mais o julgamento sobre remover o último
  dono, que este ADR não tem material para fazer. Decisão separada, se alguém
  a pedir.
- **Alargar o teto da REMOÇÃO de membro de projeto para a promoção.** Ver o
  ponto 5. O ADR 0156 protegeu esse movimento por escrito e ele fica byte a
  byte.
- **Mexer em `ResolveEffectiveRoleUseCase.forProject`.** Terceiro ADR seguido
  em que isto é dito: `projectRole ?? workspaceRole` fica nos dois sentidos.
- **Gate na tela.** Não há tela: `POST /workspaces/:workspaceId/members` não
  tem chamador no `apps/web` — medido; a única ocorrência é o tipo gerado em
  `api-types.generated.ts`. Quem chama a rota hoje é o `seed.ts` (pelo caso de
  uso, com o `owner` como ator) e integrações diretas. Não há toast para
  ajustar, e nenhuma linha de web muda.

## Consequences

**Um `maintainer` legítimo que precise de `owner` no projeto passa a depender de
outra pessoa.** É o custo direto da decisão do ponto 4, e não é hipotético: era
o caminho pelo qual alguém com o papel da rota se dava o papel de que precisava
para a tarefa seguinte. Continua alcançável — por qualquer outro `maintainer` do
projeto, e por qualquer `owner` do workspace —, e o que se compra é que a
elevação de papel passe a ter duas pessoas. É a mesma troca que o ADR 0127 fez
para descer, com o mesmo preço na mesma moeda.

**A frase do ADR 0127 sobre a auto-promoção fica FALSA, e é este ADR que a
substitui.** Ela segue escrita lá, como toda decisão superada neste
repositório; quem a ler tem de chegar até aqui. É por isso que a linha do índice
e o docblock de `ehAutoRebaixamento` nomeiam a revisão.

**O teste que fixava a permissão foi INVERTIDO, não apagado**, com o nome
guardando a origem — *"subir o próprio papel era permitido por ser 'não
rebaixamento', e passa a ser 403 (ADR 0157)"*. Mesma forma que o 0156 usou para
o teste de lacuna da remoção. É a evidência de por que a capacidade existiu, e
ela não se joga fora.

**Uma consulta a mais por associação de workspace**, e só uma: o papel do ator.
A rota é de administração e a comparação é pura, então o custo é o mesmo que o
0127 aceitou no projeto (onde eram duas) e o 0156 na remoção (duas).

**A assinatura mudou, e havia DOIS chamadores** — o controller e
`apps/api/src/db/seed.ts`, que passa `owner.id` como ator. Ali o ator e o alvo
são pessoas diferentes de propósito, então nenhum teto é alcançado e o seed não
ganha exceção nenhuma. **`CreateWorkspaceUseCase` não é chamador**, e é bom que
não seja: ele grava o criador como `owner` pelo repositório, dentro da
transação de criação, o que é uma auto-promoção legítima — a única do produto —
e passaria a ser recusada se um dia fosse roteada por aqui. O comentário ao lado
da cláusula de papel nulo registra isso.

**A superfície da rota mudou sem mudar nenhuma resposta de sucesso**, e está em
`docs/security-surface.md`: `role:owner` continua na tabela e continua sendo o
que o `RolesGuard` aplica, mas deixou de ser a resposta completa para "quem pode
o quê aqui" — a terceira rota desta família a receber essa nota.

**Segue possível, com nome:** um `owner` rebaixando OUTRO `owner` (ponto 3,
reversível pela mesma rota); rebaixar qualquer pessoa que não seja o chamador,
em qualquer escopo, que é a capacidade de sempre; e a auto-PROMOÇÃO pela
remoção da própria linha de projeto — remover a linha que restringia alguém
eleva o efetivo dele, e o ADR 0156 protegeu esse movimento de propósito.
