# 0081 — Ciclo de vida do container: tabela de estado, sem orquestrador

## Status

Aceito, **com o mesmo tipo de corte que o [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)
já declarou para esta fatia**: a tabela e a máquina de estados existem; o
que comanda um container Docker de verdade não existe, e não é este
documento que decide como ele vai existir.

Este ADR **revisa o [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)**,
fechando a metade que a seção "O que este ADR NÃO faz" dele declarava —
"estado de container precisa de tabela… o slot único de migration desta
onda pertence a outra fase" — e toca o terreno do
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md), que
permanece aceito e não é editado por nenhum dos dois.

## Contexto

O ADR 0065 entregou a metade que não precisava de banco: a decisão de
imagem do Arquiteto (`artifact.project_image`, no event log) e o portão que
ela abre para a aba Code (RN-105). Ele foi explícito sobre o que faltava:

> **O ciclo de vida do container (25b).** Provisionar, parar, reciclar,
> limpar; o que acontece quando a imagem muda; o que sobrevive a restart; o
> worktree do agente passando a viver dentro do container.
>
> O motivo é concreto e não é falta de desenho: **estado de container
> precisa de tabela**. Id do container, status, imagem em uso, quando
> subiu, a qual versão do artefato corresponde — nada disso é evento, é
> estado mutável, e forçá-lo no event log seria usar a ferramenta errada
> porque a certa estava ocupada. O slot único de migration desta onda
> pertence a outra fase.
>
> Entregar meio provisionamento seria pior que não entregar: **um
> container que sobe e não recicla é pior que nenhum**.
> — ADR 0065

O PROGRAMA 28 chegou à onda com o slot de migration livre para esta tabela.
Antes de escrever uma linha de código, uma pergunta teve de ser respondida
com uma investigação, não com suposição: **algum serviço do produto já
consegue comandar um container Docker?**

A resposta, verificada linha por linha em `docker/docker-compose.yml`: não.
Nenhum serviço (`api`, `engine`, nem os de desenvolvimento) monta
`/var/run/docker.sock`, e nenhum roda `privileged: true`. Isso não é uma
omissão a corrigir de passagem — é a ausência de uma decisão de segurança
real, e decisão de segurança real não nasce como efeito colateral de uma
tabela. Montar o socket do Docker num container é um vetor conhecido de
escalação para root no host; conceder isso sem que o usuário o autorize
explicitamente, com as consequências na mesa, seria o mesmo erro que o
ADR 0065 já registrou não cometer com rede e recursos: "decidido UMA vez,
não comando a comando" — e "decidido uma vez" pressupõe alguém decidindo,
não um ADR de infraestrutura escolhendo por conveniência.

## Decisão

### A tabela é o CONTRATO de um orquestrador que ainda não existe

`project_containers` (migration `0046`) grava o ESTADO mutável do
container de um projeto: `status` (máquina de estados explícita, abaixo),
`image_version` (a versão de `artifact.project_image` que esta linha
corresponde — nunca uma cópia de `image`/`rationale`/`network`, que
continuam vivendo só no event log), `container_id` (o id real no daemon
Docker, `NULL` sempre até um orquestrador existir), o teto de recursos
DECLARADO (`cpus`/`memory_mb`/`pids_limit`, espelhando
`RecursosDoContainer` do artefato vigente no momento em que a linha
nasceu) e `failure_reason`.

Uma linha por PROJETO (`project_id` único) — o mesmo desenho de
`dev_agent_states` no engine (ADR 0045): só existe um container vigente
por vez, e reprovisionar depois de remover reusa a mesma linha em vez de
acumular histórico nela. Histórico imutável já tem lugar — o event log —,
e esta tabela não tenta ser as duas coisas.

### A máquina de estados

`provisioning → running ⇄ stopped`, com `failed` alcançável de
`provisioning`/`running`/`stopped` e `removed` como o único estado do qual
só se sai reprovisionando (`removed → provisioning`). Nenhum estado é
terminal de verdade: mesmo `removed` permite subir de novo, porque um
projeto pode reprovisionar com uma imagem revisada pelo Arquiteto.
Validada em `apps/api/src/domain/containers/container-lifecycle.ts`, no
MESMO formato de `session-state-machine.ts` e `pr-gate-state-machine.ts`
— tabela de transições permitidas, função pura, erro tipado
(`InvalidContainerTransitionError`) que o caso de uso traduz para 409.

A PRIMEIRA transição é especial: não existe linha até a primeira chamada
com `to: 'provisioning'`, e ela só é aceita se o Arquiteto já tiver
decidido a imagem (RN-105) — o mesmo portão que já protege a aba Code,
aplicado aqui na origem em vez de duplicado. A versão e os recursos da
decisão vigente naquele instante são CONGELADOS na linha nova; uma
revisão posterior do artefato não muda retroativamente o que uma
instância já provisionada promete — reprovisionar é que lê o artefato de
novo.

### Nenhuma chamada a Docker — em nenhum dos dois casos de uso

`RegistrarTransicaoDeContainerUseCase` e
`ObterCicloDeVidaDoContainerUseCase` fazem exatamente o que os nomes
dizem: gravam e leem. Nenhum dos dois invoca `docker run`, `docker stop`,
a Docker Engine API ou qualquer client Docker — não existe um client
Docker no código do produto. Um orquestrador real, quando existir, é quem
CONSOME esta tabela: age primeiro contra o daemon, e só então chama
`RegistrarTransicaoDeContainerUseCase` para registrar o que aconteceu —
nunca o contrário, pela mesma razão que `TransitionSessionUseCase.activate`
chama o engine ANTES de escrever `active`: a tabela não deve dizer que
algo está rodando quando não está.

### Coerência com o modo do workspace (ADR 0072)

Um projeto em `workspace_mode: 'local'` não sobe container — ele roda no
container do AGENTE de sempre, só a pasta mudou (RN-169). Pedir uma
transição para um projeto `local` é recusado com 400 antes de tocar a
tabela: a coerência não é "a tabela permite qualquer estado para qualquer
projeto e a UI filtra depois", é o caso de uso recusando na origem.

### Nenhuma rota HTTP nova

Nada na Onda 4 consome esta tabela por HTTP ainda — o terminal
interativo (25b/Onda 5) é o candidato óbvio, e decidir a forma da rota
antes de saber exatamente o que ele precisa ler seria adivinhar um
contrato. Os dois casos de uso ficam expostos ao módulo de containers,
prontos para uma rota quando houver consumidor real.

## Consequências

**O que passa a existir.** Um lugar único e testado para responder "em
que estado está o container deste projeto" e para registrar uma
transição validada — pré-requisito de QUALQUER orquestrador futuro, sem
o qual ele teria que inventar o próprio armazenamento de estado ou
reabrir esta decisão.

**O que continua exatamente como estava — sem atenuar.** A metade "dentro
o agente é livre" da política de terminal, que o ADR 0065 já dizia não
ter mudado, CONTINUA não tendo mudado. O ADR 0055 (escopo de caminho,
allowlist estreito) segue valendo palavra por palavra. Um container
`running` nesta tabela não muda o que o terminal permite executar, porque
nenhum comando de terminal hoje é roteado para dentro de um container
gerido por ela — a tabela e a execução de comandos são dois sistemas que
ainda não se tocam. Os achados Z e AD (allowlist de verbo não converge)
continuam abertos pelo motivo de sempre: fechar exige a parede física
(um orquestrador real isolando execução), não uma tabela que descreve a
intenção de uma parede.

**O que fica declarado, não escondido.** Não existe hoje nenhum processo
que transicione esta tabela sozinho — toda transição é, por enquanto,
externa (teste, ou uma chamada manual). Isso é o esperado: a tabela nasce
antes do consumidor, não depois. O dia em que um orquestrador real for
desenhado — sidecar com privilégio restrito, daemon separado, ou outro
formato — é uma decisão de segurança própria, com o usuário informado do
que está sendo concedido, exatamente como o ADR 0065 já exige para rede e
recursos. Este documento não a antecipa nem a atalha.

## Alternativas consideradas

**Montar `/var/run/docker.sock` na api ou no engine para "fazer funcionar
de verdade" já nesta fatia.** Recusada com o argumento mais direto que
existe: é uma decisão de segurança (vetor conhecido de escalação a root
no host) que ninguém pediu nesta fatia, e tomá-la de passagem para fazer
uma tabela "parecer completa" é exatamente o erro que a FASE 13 já
nomeou — não é afrouxar allowlist de verbo, mas é a mesma classe de
atalho: ganhar funcionalidade trocando garantia por conveniência.

**Não criar a tabela agora, esperar o orquestrador estar desenhado.**
Recusada pelo motivo que o próprio ADR 0065 já deu: o slot de migration
é escasso (uma por onda) e a tabela é pré-requisito, não acessório, de
qualquer desenho de orquestrador — desenhá-lo sem ter onde gravar estado
produziria a mesma tabela depois, sob pressão de um consumidor real
esperando.

**Guardar o estado como um segundo tipo de evento no event log
(`container.status_changed`), em vez de tabela.** Recusada pelo mesmo
argumento que a distingue de `artifact.project_image`: isto é ESTADO
(um valor por vez), não FATO histórico. Projetar "o estado atual" a
partir de eventos a cada leitura reimplementaria uma tabela em cima do
event log, pagando o custo de indireção sem ganhar nada — a mesma
conclusão que "Alternativas consideradas" do ADR 0065 já registrou ao
adiar esta tabela.

## Referências

- [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) —
  a decisão de imagem e o portão que este documento não repete, só referencia.
- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) — a política
  de terminal que CONTINUA valendo como está; nenhuma linha muda aqui.
- [ADR 0072](0072-projeto-local-ou-container.md) — `workspace_mode`, que
  decide se um projeto tem ciclo de vida de container ou não.
- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) — a máquina de
  estados persistida (`dev_agent_states`) cujo desenho (uma linha por
  agente, `status` validado fora da coluna) esta tabela espelha para
  container.
- [RN-105](../business-rules.md#rn-105), [RN-169](../business-rules.md#rn-169),
  [RN-243](../business-rules.md#rn-243)–[RN-248](../business-rules.md#rn-248).
- `docs/explanation/achados-execucao-real.md` — os achados Z e AD, que
  este documento explicitamente NÃO fecha.
- `apps/api/src/domain/containers/container-lifecycle.ts`,
  `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`,
  `apps/api/src/application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case.ts`,
  `apps/api/src/db/migrations/0046_chilly_forgotten_one.sql`.
