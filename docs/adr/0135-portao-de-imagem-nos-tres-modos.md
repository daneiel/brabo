# 0135 — O portão da imagem do Arquiteto (RN-105) passa a valer nos três modos de execução

## Context

Desde a FASE 25 (ADR 0065/RN-105), a aba Code de um projeto responde 409
enquanto ninguém decidiu qual imagem de container ele executa —
`artifact.project_image`, emitido pelo Arquiteto (`choose_project_image`) e,
desde o ADR 0133 (RN-491), também pela Infra elegendo entre candidatas do
próprio roteamento do Arquiteto. A ordem é do usuário: o container é o que
dá sentido a ler o código ali, e liberar a leitura antes de existir onde
executar ensinaria que o portão é decorativo.

O ADR 0072 (RN-169), revisado pelo ADR 0104 (RN-421), dispensou esse portão
para projeto `mounted`/`runner`: como esses dois modos não sobem container
PRÓPRIO — o código mora numa pasta do usuário, montada nos containers que já
existem (`mounted`) ou confirmada por um CLI rodando fora deles (`runner`) —
a regra original respondia 409 para sempre num projeto onde a decisão do
Arquiteto nunca ia acontecer. A dispensa evitava fechar a aba por efeito
colateral.

O plano original desta entrega ("Execução em container real", Parte 1)
declarou essa dispensa como decisão #5 a reabrir, já aceita antes de este PR
existir: *"Portão RN-105 passa a valer nos TRÊS modos, container e aba Code.
Custo aceito: exp001/exp002 perdem a aba Code até o Arquiteto decidir."* Este
ADR executa essa decisão e registra o que ela custa e o que ela NÃO muda.

A dispensa original confundia duas perguntas que o ADR 0130 (broker de
container) e o ADR 0133 (eleição da Infra) separaram, sem que a api tivesse
acompanhado: "este projeto sobe container no SERVIDOR?" (não, em
`mounted`/`runner` — pergunta sobre MECANISMO) e "faz sentido exigir que
alguém tenha decidido a imagem do projeto antes de abrir a leitura de
código?" (sim, nos três modos — pergunta sobre POLÍTICA). A dispensa
respondia a segunda pergunta usando a resposta da primeira.

## Decision

**Os TRÊS modos de execução (`container`/`mounted`/`runner`) passam a exigir
`artifact.project_image` decidido antes de a aba Code abrir.**
`ReadProjectCodeUseCase.portaoDoContainer` deixa de checar `executionMode` —
o portão vira incondicional, do mesmo jeito que já era incondicional dentro
do modo `container`. `ProjectCodeTab` (web) para de tratar `mounted`/`runner`
como caso à parte: os três modos seguem o mesmo `useQuery`
carregando/erro/`sem_decisao`/decidido, o que SIMPLIFICA o componente — o
ramo `modoLocal` e o `enabled` condicional por modo somem.

**Custo aceito, com todas as letras**: todo projeto `mounted`/`runner`
EXISTENTE sem `artifact.project_image` decidido — o que inclui projetos
reais de dogfooding deste repositório, `exp001` e `exp002` — PERDE acesso à
aba Code no instante em que este PR é deployado, até que o Arquiteto (ou a
Infra) decida uma imagem para ele. Isso é uma AÇÃO DO OPERADOR exigida
DEPOIS do deploy, não uma correção transparente que os usuários nem notam —
por isso a branch nasce `breaking/`, não `bugfix/`, mesmo o conteúdo sendo
uma correção de lacuna: a convenção do repositório (CLAUDE.md) é explícita
que o conteúdo não decide o prefixo quando a mudança exige ação do operador.
A versão sobe MAJOR como consequência mecânica de `scripts/ci/version.ts`,
não por decisão manual — não se corrige o número depois.

**O ciclo de vida do container (`project_containers`) também para de
recusar por modo, mas por um motivo mais estreito.**
`RegistrarTransicaoDeContainerUseCase` respondia 400 para qualquer projeto
fora do modo `container` — uma checagem que pertencia, na verdade, ao
broker (que já recusa por um motivo PRÓPRIO e mais específico), não a este
caso de uso. O 400 sai; a tabela passa a poder registrar linha para os três
modos, pelo MESMO funil de `provisioning` que já lia a decisão de imagem
(agora também exigida para `mounted`/`runner`).

**O que continua IMPOSSÍVEL, e por decisão deliberada, é `mounted`/`runner`
chegarem em `running` DE VERDADE.** Isso é aplicado num lugar só —
`ContainerBrokerPort.start()` recusa com `ModoDeExecucaoNaoSuportadoError`
(`apps/broker/src/operacoes.ts`): o broker roda no SERVIDOR e não enxerga a
pasta do usuário onde o código de `mounted`/`runner` mora, então compor um
container ali seria compor a partir de uma pasta vazia. Essa política NÃO
muda neste PR — o comentário da classe de erro já apontava para este ADR
("o PR do portão nos três modos (1.7) revisita as duas ao mesmo tempo") e a
revisão confirma que ela está certa como está.

Investigado e decidido, sem mudança de código: `ExecuteContainerStartUseCase`
chama `ContainerBrokerPort.start()` ANTES de qualquer
`RegistrarTransicaoDeContainerUseCase.execute(..., 'provisioning')` — se o
broker recusa (o caso normal para `mounted`/`runner`), a falha vira
`container.start_failed` com o motivo nomeado (`BrokerRecusouError`,
NUNCA um crash ou um fallback silencioso) e a transição de ciclo de vida
nunca chega a ser chamada. Ou seja: pelo caminho real de aprovação
(`container_start`), nenhuma linha de `project_containers` nasce para
`mounted`/`runner` mesmo com o 400 por modo removido — o broker já é o
portão efetivo, mais preciso que o antigo 400 (ele sabe SE PODE compor o
container; o caso de uso só sabia o MODO). Por isso este PR NÃO adiciona uma
segunda checagem de modo em `propose-action.use-case.ts` nem em
`ExecuteContainerStartUseCase`: duplicar criaria um segundo lugar para
divergir do primeiro — a mesma lição que o próprio comentário do broker já
registrava.

Também investigado: nem `propose_container_start` (a ferramenta do Infra
Lead, `apps/engine/lib/engine/infra/tools/propose_container_start.ex`) nem
`GetInfraContextUseCase` restringem por `executionMode` hoje — o Infra Lead
PODE propor `container_start` para um projeto `mounted`/`runner`, e a
proposta só falha quando alguém aprova e o broker recusa. Isso é uma
lacuna PRÉ-EXISTENTE (não introduzida por este PR) que gasta um ciclo de
aprovação humana numa ação destinada a falhar — mas falha de forma clara,
nomeada, nunca silenciosa. Corrigi-la exigiria tocar o prompt/instrução do
Infra Lead no engine, fora do escopo desta fatia (API/domínio); fica
declarada abaixo, não corrigida de passagem.

## Consequences

**`exp001`/`exp002` e qualquer outro projeto `mounted`/`runner` sem imagem
decidida perdem a aba Code até alguém rodar o Arquiteto (ou a eleição da
Infra) para eles.** Este é o custo aceito da decisão #5 do plano original,
não um efeito colateral descoberto depois.

**A contenção real contra `mounted`/`runner` subirem container no servidor
não mudou.** Continua sendo o broker (`ModoDeExecucaoNaoSuportadoError`),
não um 400 da api — na verdade FICOU mais precisa, porque agora há um lugar
só decidindo isso em vez de dois.

**`project_containers` pode, em teoria, registrar linha `provisioning` para
`mounted`/`runner`** — mas nenhum caminho de produção hoje chama
`RegistrarTransicaoDeContainerUseCase.execute(..., 'provisioning')` para
esses modos sem passar primeiro pelo broker, que recusa. Se um caminho novo
algum dia contornar `ExecuteContainerStartUseCase` (chamando o caso de uso
direto), ele herda a mesma proteção: `obterImagem.execute` continua exigindo
decisão, e nada além disso muda aqui.

**O Infra Lead pode propor `container_start` para um projeto `mounted`/
`runner` sabendo que vai falhar** — lacuna pré-existente, não introduzida
nem fechada por este PR, declarada no CLAUDE.md ("Estado atual e aberto")
para não ser perdida.

**Alternativa considerada e descartada: adicionar a checagem de modo em
`propose-action.use-case.ts` ou em `ExecuteContainerStartUseCase`, para
recusar `container_start` de `mounted`/`runner` ANTES de chamar o broker.**
Evitaria o ciclo de aprovação desperdiçado citado acima — mas moveria
conhecimento sobre QUEM pode compor um container (hoje só o broker sabe,
via `PROJECT_WORKSPACES_HOST_ROOT`) para dentro da api, que não tem esse
contexto e replicaria uma regra que já existe em outro lugar. Descartada por
ora: o custo é um ciclo de aprovação evitável, não incorreção — e a mensagem
de falha já nomeia a causa. Fica registrada como candidata a UX, não como
correção de bug, se o volume de propostas fúteis justificar.
