# 0065 — Container por projeto: a fronteira deixa de ser política

## Status

Aceito, **com corte declarado**. A metade que este ADR entrega — o artefato do
Arquiteto, o portão e a fronteira de efeito externo — está implementada e
provada por teste. A metade que ele **não** entrega — provisionar, parar,
reciclar e limpar o container — está declarada em "O que este ADR NÃO faz", com
o motivo. O corte é do escopo, não do argumento: a decisão de arquitetura vale
inteira e é ela que dita o que a fase seguinte constrói.

Este ADR **revisa o [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)**,
que continua aceito e não é editado. O 0055 diz de si, na seção de
consequências, que é *política, não isolamento*, e registra o container por
projeto como pendência explícita. É essa pendência que este documento endereça.

## Contexto

### A dívida, nas palavras do documento que a criou

> **O que este ADR NÃO resolve.** Escopo é **política**, não isolamento.
> Enquanto o monorepo do Brabo estiver montado em `/workspace` dentro do
> container que executa os comandos, a fronteira depende da política acertar.
> — ADR 0055

E a nota de aceite do mesmo documento, que mede o buraco que sobrou: a
normalização de caminho é **léxica**, `..` reprova, e **symlink de dentro do
projeto apontando para fora não é detectado**. Fechar isso não é escrever uma
regra melhor — é ter uma parede.

Hoje o agente executa no **mesmo container que o monorepo do Brabo**. O que o
separa do código da plataforma que o executa é uma comparação de string em
`decide.ts`.

### Os achados que não convergem

A FASE 13b deixou dois achados abertos, e o argumento deles vale mais que a
lista de execuções que os produziu (`docs/explanation/achados-execucao-real.md`):

- **Z e AD** — o allowlist de verbos **não converge**. Verbo, forma e invocação
  são espaços distintos: `curl`, `wget`, `python -c "urllib..."` e um script
  `.sh` que faz qualquer um dos três são o mesmo egresso escrito de quatro
  maneiras. As execuções 6, 7 e 8 travaram em um de cada.
- **AE** — o agente de QA tenta consertar o código que julga, contra o próprio
  prompt, contido por duas barreiras independentes (allowlist e escopo).

A conclusão da FASE 13, escrita antes desta fase existir, é a mesma a que este
ADR chega: **o caminho para autonomia não passa por afrouxar política**.

### O que o usuário decidiu

> "Cada projeto tenha sua própria infra apartada, ou seja, subirá via container
> por cada projeto, isolando assim o terminal e dando permissão total a ele; o
> code somente é liberado após definição do arquiteto, pois ele que definirá
> qual tipo de container subirá aquele código, pois será o decisor de melhor
> oportunidade para qual imagem ser a melhor."

E, sobre o alcance da permissão total:

> "Agente livre para o que quiser desde que não seja comandos de git ligado ao
> deploy e ao PR — estas ações ainda devem ser humanas."

Duas frases, três decisões: **quem** escolhe a imagem, **quando** o Code libera,
e **onde** a liberdade termina.

## Decisão

### 1. A imagem do projeto é ARTEFATO do Arquiteto

`artifact.project_image` no event log, com `image`, `rationale`, `network` e
`resources`. Versionado — revisar é emitir uma versão nova, e o vigente é o de
maior `version`.

Artefato e não configuração porque **quem escolhe a imagem escolhe o que o
agente consegue fazer**: qual runtime existe, qual gerenciador de pacotes, qual
compilador. Isso é decisão de arquitetura, do mesmo calibre do `module_map`, e
decisão de arquitetura tem autor, data e porquê. Uma variável de ambiente não
tem nenhum dos três.

**Sem tabela, e não por economia.** O event log já dá as três propriedades que a
decisão precisa ter — imutável, versionada, com autor — e é onde
`artifact.module_map` e `artifact.business_rule` já moram. Uma tabela daria a
mesma coisa com um `UPDATE` possível, e `UPDATE` em decisão de arquitetura é
como ela deixa de ser auditável.

**Tag explícita, `latest` recusado.** Um artefato que diz `node:latest` não
descreve nada: o container de março e o de hoje são imagens diferentes com o
mesmo nome, e a auditoria passa a mentir.

**Teto de recursos que recusa em vez de rebaixar.** Pedido acima do máximo é
400 com o motivo, nunca um corte silencioso — um artefato que promete mais do
que o container recebe mente para quem o audita.

### 2. Enquanto o Arquiteto não decidir, o Code não libera

O portão é a ordem literal do usuário, e a razão dele é de produto: o container
é o que dá sentido a ler código ali — ler para depois rodar, buildar, corrigir.
A superfície de leitura da [ADR 0060](0060-superficie-de-leitura-de-codigo.md)
responde **409** enquanto o estado for `sem_decisao`, com a mensagem dizendo o
que falta.

409 e não 403: nada está errado com quem pediu nem com a permissão dele — o
recurso ainda não existe neste estado. E a checagem mora no **mesmo funil** que
a contenção de caminho (`alvo`), não nas quatro rotas, pelo motivo da
[RN-092](../business-rules/custo.md#rn-092): checagem duplicada em quatro chamadores é
checagem que um dia diverge em um deles.

### 3. A fronteira: dentro é livre, fora é humano

**Dentro** do container o agente é livre — ler, escrever, instalar, buildar,
testar, rodar. É isto que fecha Z e AD, e é o único jeito conhecido de fechá-los:
a parede substitui a enumeração.

**Fora** continua humano. Três efeitos atravessam a parede e chegam no mundo —
`git push`, abertura de PR e deploy — e comando de terminal que os invoca é
**negado**, com a mensagem dizendo qual ação **tipada** usar.

**`deny` e não `require_approval`**, e esta é a parte que exige argumento. Cada
um desses efeitos já tem caminho tipado (`git_push`, `pr_open`, `git_merge`) que
nasce `proposed_action`, tem papel mínimo próprio, é executado pela plataforma e
deixa no event log **o que foi empurrado e para onde**. O terminal seria uma
segunda porta para o mesmo efeito, sem nenhuma dessas garantias: o log diria
"um comando rodou". E `require_approval` não bastaria porque existe "sempre
permitir" — um clique gravaria o padrão em `allow` e a segunda porta ficaria
aberta para sempre. `deny` vence `allow` em qualquer estágio, e é por isso que
ele é a forma certa desta regra: não é preferência configurável, é onde o
container termina.

Negar não tira poder do agente — **redireciona**. Foi assim que o dev agent
sempre fez (`agent_io.ex` propõe `git_push`); o que muda é que agora está
garantido, e não só combinado. E merge em branch protegida segue manual pela
[RN-014](../business-rules.md#rn-014), intocada.

### 4. Rede é postura do CONTAINER, decidida uma vez — não comando a comando

Esta é a decisão que o veredito próprio pedido sobre rede produz, e ela é o
contrário do que a intuição sugere.

A tentação seria acrescentar egresso ao allowlist: proibir `curl`, `wget`,
`npm install`. **É exatamente a tentativa que Z e AD provaram não convergir.**
Um allowlist de egresso teria a mesma forma, o mesmo tamanho e o mesmo destino
do allowlist de verbos.

Então a rede é decidida **uma vez**, no artefato, na fronteira que o kernel
entende: `network: none` é o default, e é o que torna "dentro o agente é livre"
uma frase segura — livre num lugar sem saída. `egress` é pedido legítimo (uma
stack que baixa dependências não funciona sem ele), o Arquiteto declara com
justificativa, e **quem autoriza é o usuário**, no provisionamento — pelo mesmo
motivo que autoriza o teto de paralelismo ([ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)):
sair para a internet é gasto e é superfície.

**Gasto** tem o mesmo tratamento: `cpus`, `memoryMb` e `pidsLimit` no artefato,
com teto duro. `pidsLimit` merece nota — é o que contém fork bomb sem depender
de allowlist de verbo nenhum, e é o exemplo mais limpo do que muda quando a
fronteira deixa de ser léxica.

Os tetos de **token** não mudam: continuam sendo projeto, sessão e task.

## O que este ADR NÃO faz

**O ciclo de vida do container (25b).** Provisionar, parar, reciclar, limpar; o
que acontece quando a imagem muda; o que sobrevive a restart; o worktree do
agente passando a viver dentro do container.

O motivo é concreto e não é falta de desenho: **estado de container precisa de
tabela**. Id do container, status, imagem em uso, quando subiu, a qual versão do
artefato corresponde — nada disso é evento, é estado mutável, e forçá-lo no
event log seria usar a ferramenta errada porque a certa estava ocupada. O slot
único de migration desta onda pertence a outra fase.

Entregar meio provisionamento seria pior que não entregar: **um container que
sobe e não recicla é pior que nenhum** — ele acumula, ninguém sabe de quem é, e
a primeira imagem decidida vira permanente na prática.

**Consequência honesta do corte:** a metade "dentro o agente é livre" **ainda
não valeu**. A política de terminal do ADR 0055 continua exatamente como está —
escopo de caminho, allowlist estreito, `cd` afrouxado dentro do escopo. Afrouxar
antes de a parede existir seria repetir o erro que este documento veio corrigir,
e a FASE 13 já escreveu a conclusão: o caminho para autonomia não passa por
afrouxar política. O que esta fase entrega é a **metade FORA** da fronteira — a
que precisa valer antes, não depois.

## Consequências

**O que melhora agora.** A decisão de imagem existe, tem dono, versão e
justificativa; o portão do Code é real e testado nas quatro rotas; e a segunda
porta para push/PR/deploy fechou — antes dela existir de fato, que é a hora
certa de fechar uma porta.

**O que muda para o operador.** Projeto existente **não tem** decisão de imagem,
então a aba Code passa a responder 409 até o Arquiteto rodar. É mudança de
comportamento observável de uma superfície que acabou de entrar (ADR 0060), e é
por isso que esta mudança nasce em `breaking/`: quem já usava a aba precisa
saber por que ela fechou.

**O que se perde.** Nada de execução: nenhum comando que funcionava deixa de
funcionar, porque `git push` pelo terminal nunca foi como o dev agent empurra.
O que se perde é a *possibilidade* de configurar um atalho por terminal para
push/PR/deploy — e perder isso é o ponto.

**O que fica devendo, medido.** O symlink de dentro apontando para fora
**continua não detectado**. Este ADR não fecha esse vetor; ele decide como
fechá-lo (parede) e entrega a decisão de imagem que a parede precisa. Enquanto o
container não subir, a fraqueza do 0055 segue valendo, e está escrito aqui em
vez de ser confundido com resolvida.

## Alternativas consideradas

**Afrouxar a política agora e subir o container depois.** Recusada com o
argumento mais forte que o projeto tem: é literalmente a conclusão da FASE 13 ao
contrário. Liberdade sem parede é o buraco, não a solução.

**Um allowlist de egresso de rede.** Recusada por Z e AD: teria a mesma forma e o
mesmo destino do allowlist de verbos. Rede é propriedade do container.

**A imagem como configuração do projeto (coluna, `.env`, tela de Configurações).**
Recusada porque tira do Arquiteto a decisão que o usuário deu a ele, e porque
configuração não tem porquê. O `rationale` obrigatório é o que faz a decisão ser
revisável em vez de arqueológica.

**Uma tabela `project_containers` agora.** É o desenho certo para o **estado**
do container, e é justamente por isso que ele fica para a onda com slot de
migration. Improvisar o estado no event log para não esperar produziria a
migration de correção logo em seguida.

**`require_approval` no terminal em vez de `deny`.** Recusada pelo "sempre
permitir": ele grava o padrão em `allow`, e um clique bastaria para a segunda
porta ficar permanentemente aberta.

## Referências

- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) — a política que
  este documento revisa, e que declarou esta pendência de si mesma.
- [ADR 0060](0060-superficie-de-leitura-de-codigo.md) — a aba Code, cujo portão
  esta decisão fecha.
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — quem autoriza gasto é
  quem responde pelo projeto; a rede segue o mesmo critério.
- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) — o worktree é por
  AGENTE, não por task; é ele que passa a viver dentro do container.
- [RN-014](../business-rules.md#rn-014), [RN-092](../business-rules/custo.md#rn-092),
  [RN-105](../business-rules/autenticacao.md#rn-105), [RN-106](../business-rules/autenticacao.md#rn-106).
- `docs/explanation/achados-execucao-real.md` — os achados Z, AD e AE.
- `apps/api/src/domain/containers/project-container.ts`,
  `apps/api/src/domain/actions/external-effect.ts`,
  `apps/api/src/application/use-cases/containers/`,
  `apps/engine/lib/engine/harness/tools/choose_project_image.ex`.
