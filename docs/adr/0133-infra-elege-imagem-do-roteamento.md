# 0133 — A Infra elege entre as candidatas do roteamento, e a eleição vira nova versão de `artifact.project_image`

## Context

O ADR 0131 abriu a metade que faltava do roteamento de módulos: o Arquiteto
CANDIDATA uma imagem por módulo (`route_modules_to_infra`, gravado em
`artifact.module_routing`) e declarou, com todas as letras, que "a metade que
ELEGE (o Infra Lead lendo esta lista e decidindo, com `proposed_action`
própria) é um PR separado". Este é esse PR.

O ADR 0130 (broker de container) também deixou uma frase pendurada, no
próprio comentário do `ContainerBrokerPort`: "Subir, parar e remover são
EFEITO EXTERNO e não acontecem sem `proposed_action`; quem vai propor é o
Infra Lead, com autoridade final do usuário, e isso é outro PR." Também este.

A pergunta que os dois ADRs deixaram em aberto, e que só aparece quando se
tenta LIGAR os dois fios, é: o broker não aceita especificação — ele lê
`GET /internal/projects/:projectId/container-spec`
(`ObterSpecDeContainerUseCase`), que por sua vez lê a decisão vigente do
Arquiteto em **`artifact.project_image`** (RN-105, `DecidirImagemDoProjetoUseCase`,
ADR 0065). Ele NÃO lê `artifact.module_routing`. Então: se a Infra elege uma
candidata do roteamento e isso não vira uma nova versão de
`artifact.project_image`, a eleição é auditável no event log e **inerte** — o
container que sobe continua sendo o que `choose_project_image` decidiu, que
pode nem existir ainda, ou pode ser uma imagem completamente diferente da
eleita.

## Decision

**A eleição da Infra emite uma NOVA VERSÃO de `artifact.project_image`,
reusando `DecidirImagemDoProjetoUseCase` inteiro — não um caminho paralelo.**

Isso significa: `artifact.project_image` deixa de ser emitido só pelo
Arquiteto (`choose_project_image`). Passa a ter DOIS emissores possíveis —
o Arquiteto, decidindo do zero, e a Infra, ELEGENDO entre as candidatas do
roteamento que o próprio Arquiteto produziu — e o `decidedBy` de cada evento
diz qual foi (`'arquiteto'` vs. `'infra-lead'`, já que `DecidirImagemDoProjetoUseCase.execute`
já aceitava esse parâmetro, só nunca usado com outro valor). O comentário no
código de `project-container.ts` que chama a imagem de "ARTEFATO DO
ARQUITETO" continua verdadeiro no sentido que importa — é decisão de
arquitetura, versionada, auditável, nunca configuração escondida — mas deixa
de ser verdadeiro no sentido de "só o Arquiteto escreve nele". O CLAUDE.md
(seção Convenções) é atualizado para declarar isso.

**Por que reusar `DecidirImagemDoProjetoUseCase` em vez de um caminho
paralelo que grava `artifact.project_image` diretamente:**

1. **Mesma validação, uma vez só.** `validarDecisaoDeImagem`
   (tag/digest explícito, `latest` recusado, `rationale` mínimo, teto de
   `RECURSOS_MAXIMOS`) já é a fonte única dessa regra — reimplementá-la no
   caminho da Infra criaria a MESMA divergência que o comentário de
   `module-routing.ts` já registrou ao decidir reusar essa função em vez de
   reescrevê-la por módulo. Mesmo raciocínio, uma camada acima.
2. **Um vigente, não dois.** `ObterContainerDoProjetoUseCase` lê "a versão de
   maior número" de `artifact.project_image` — se a eleição da Infra gravasse
   em outro tipo de evento, ou em uma tabela própria, o produto passaria a ter
   DUAS respostas possíveis para "qual imagem este projeto roda", e todo
   consumidor existente (`RegistrarTransicaoDeContainerUseCase`, o portão RN-105
   da aba Code, o broker via `ObterSpecDeContainerUseCase`) precisaria aprender
   a escolher entre elas. Reusar o mesmo artefato é o que preserva "um vigente"
   sem exigir que ninguém mude.
3. **O rastro já existe.** `rationale` é campo livre — a eleição escreve nele
   que a imagem foi ELEITA entre as candidatas do roteamento (citando o
   `porque` que a Infra deu), então quem lê o histórico de
   `artifact.project_image` meses depois não vê uma imagem aparecendo do
   nada: vê a cadeia — o Arquiteto candidatou, a Infra elegeu, com o motivo
   de cada lado.

**A imagem eleita TEM que ser uma das `imagemCandidata` do
`artifact.module_routing` vigente — nunca inventada.** `ExecuteContainerStartUseCase`
valida isso ANTES de chamar `DecidirImagemDoProjetoUseCase`: se a Infra propõe
uma imagem fora da lista, a ação falha com uma mensagem nomeando a imagem
recusada e as candidatas válidas — o mesmo mecanismo de recusa explicativa
que `validarRoteamento`/`validarDecisaoDeImagem` já usam (RN-061: o motivo
inteiro volta para quem decide corrigir). Sem roteamento vigente
(`status: 'sem_roteamento'`), não há candidata nenhuma e toda eleição é
recusada — o Arquiteto precisa rodar `route_modules_to_infra` primeiro.

**A tensão explícita, não escondida:** o Arquiteto continua sendo quem
PROPÕE (via `choose_project_image` OU via `route_modules_to_infra`); a Infra
passa a poder emitir uma nova versão do MESMO artefato quando ELEGE. Não é
"a Infra decide a imagem do zero" — é "a Infra escolhe qual das propostas do
Arquiteto vira realidade", e a escrita reflete isso: `decidedBy: 'infra-lead'`
e um `rationale` que cita a candidatura de origem, nunca um `rationale`
inventado do zero como se fosse uma decisão nova.

**`container_start` é `proposed_action` nova, com autoridade final do
usuário — nunca auto-aprovável por padrão.** Diferente de `open_infra_pr`
(que o Infra Lead pode auto-aprovar para si mesmo, porque só abre uma PR que
um humano ainda mergeia), subir o container é efeito externo de verdade —
chama o broker, que fala com o daemon Docker do servidor (ADR 0130). Fica
`require_approval` por padrão (`MIN_ROLE_FOR_ACTION_TYPE: maintainer`, mesmo
calibre de `open_infra_pr`/`parallelize`), e NÃO entra na lista de autonomia
seedada pelo `accept-handoff` do Infra Lead — decisão deliberada, não
esquecimento.

**`container_start` fica FORA do bloco de tetos absolutos de `decide.ts`**
(merge em branch protegida, `instruction_patch`, `parallelize`/
`raise_max_parallel`) — mesmo raciocínio já registrado ali para
`propose_execution_plan`/`assess_implementability`: é a PRIMEIRA vez que o
container deste projeto sobe de verdade para esta eleição, não uma
ultrapassagem de um teto já autorizado. Um `maintainer` PODE configurar
`permissions.json` para auto-aprovar `container_start`, se decidir que quer
esse nível de automação — o produto não fecha essa porta à força, do mesmo
jeito que não fecha para `open_infra_pr`.

## Consequences

**O portão RN-105 não muda.** A aba Code continua fechada até
`artifact.project_image` ter uma decisão — só que agora essa decisão pode ter
vindo de dois lugares. Nenhum consumidor existente de
`ObterContainerDoProjetoUseCase` precisou mudar.

**`container_start` é o PRIMEIRO chamador real de `ContainerBrokerPort.start`.**
Das cinco operações do ADR 0128/0130, `inspect` já tinha chamador (leitura, a
rota de ciclo de vida); `start` ganha o dele aqui. `stop`, `remove` e `exec`
continuam sem `proposed_action` nenhuma — não é lacuna corrigida por
inteiro, é uma fatia do corte da FASE 25b fechando.

**Os dev agents AINDA não trabalham dentro do container que sobe.** Subir o
container e mover o worktree do dev agent para dentro dele são coisas
diferentes — a segunda é PR à parte (1.6). Este PR prova que o caminho
proposed_action → aprovação → broker → `project_containers` funciona de
ponta a ponta; o que roda dentro do container, por enquanto, é só o que o
broker sobe (a imagem eleita, montando a pasta do projeto) — sem consumidor
ainda.

**`RegistrarTransicaoDeContainerUseCase` ganha seu primeiro chamador real
fora de teste.** A máquina de estados já existia (ADR 0081); a novidade é que
agora algo além de um teste dispara `provisioning`/`running` de verdade,
depois que o broker confirma. A transição para `provisioning` só é possível
quando não há linha ainda, ou a linha está em `failed`/`removed` — de
`stopped`, a transição correta é direto para `running` (a máquina de estados
do ADR 0081 não permite `stopped -> provisioning`, e recriar a linha do zero
para um container que só estava parado destruiria o histórico de
`imageVersion` sem necessidade).

**Alternativa considerada e descartada: um evento novo
(`artifact.container_election`, ou similar) separado de
`artifact.project_image`.** Preservaria uma separação mais limpa entre
"o Arquiteto propõe" e "a Infra decide", mas criaria exatamente o problema
que a Decision evita: dois artefatos candidatos a "a imagem vigente deste
projeto", e todo consumidor (broker via `ObterSpecDeContainerUseCase`,
`RegistrarTransicaoDeContainerUseCase`, o portão RN-105) precisando saber
escolher entre eles. Descartada porque o custo de manter dois vigentes
sincronizados supera o valor de uma separação mais "pura" entre os dois
papéis — os DOIS papéis continuam existindo (Arquiteto propõe, Infra elege),
só o artefato de saída é um só.
