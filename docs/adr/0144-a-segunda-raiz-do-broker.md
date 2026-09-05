# 0144 — A segunda raiz do broker, e o localizador discriminado que a escolhe

## Context

O broker (ADR 0130) é o único processo do produto que fala com um daemon Docker
no servidor, e a coisa que o torna contido é uma só: **ele não aceita
especificação de container**. Recebe um `projectId` e uma das cinco operações,
vai à api LER a decisão do Arquiteto e COMPÕE imagem, rede, recursos e o único
mount ele mesmo. Nenhum caminho atravessa a rede — a api mandava
`workspaceDirName` e o broker o concatenava com a raiz DELE
(`PROJECT_WORKSPACES_HOST_ROOT`).

Essa forma tinha uma raiz porque havia um lugar só onde uma pasta de projeto
podia estar do ponto de vista do servidor: `/data/project-workspaces`, a pasta
GERENCIADA pelo produto, do modo `container`. Projeto `mounted` e `runner`
ficavam de fora, e o broker recusava os dois na fonte com
`ModoDeExecucaoNaoSuportadoError`.

O ADR 0141 mudou o fato do mundo que sustentava metade dessa recusa. Todo
projeto no modo Pasta montada passa a morar sob **uma** base
(`BRABO_PROJECTS_BASE`), montada por identidade em `api` e `engine`, e portanto
alcançável pelo daemon do servidor. A recusa do broker era sobre GEOMETRIA — "o
código dele está numa máquina que eu não enxergo" —, e a geometria de `mounted`
deixou de ser essa. A de `runner` não mudou nada.

Isso abre uma pergunta que a forma de uma raiz só não sabe responder: dado um
segmento, **contra qual raiz ele vale?**

A tentação óbvia é a api mandar o caminho absoluto e o broker montá-lo. Isso
desfaria o ADR 0130 inteiro: a contenção de um processo root-equivalente no
host voltaria a depender de o CHAMADOR estar correto, que é a definição de não
haver contenção. A segunda tentação é o broker adivinhar — usar a base quando o
modo for `mounted`. Isso funciona até o dia em que existe um terceiro lugar, e
até lá esconde a decisão num `if` sobre um enum que o broker não é dono.

## Decision

**O broker ganha uma SEGUNDA raiz, `BRABO_PROJECTS_HOST_BASE`, e a api passa a
mandar um localizador DISCRIMINADO que diz contra qual das duas o segmento
vale.**

```ts
localizacao:
  | { tipo: 'gerenciada';   segmento: string }  // PROJECT_WORKSPACES_HOST_ROOT
  | { tipo: 'montada';      segmento: string }  // BRABO_PROJECTS_HOST_BASE
  | { tipo: 'indisponivel'; motivo: string }    // nenhuma raiz alcança
```

O invariante fica exatamente onde estava. O que atravessa a rede continua sendo
só a metade que a raiz do broker não cobre; a api NÃO sabe onde essas raízes
ficam no host, e o broker não sabe nada sobre o projeto. Nenhum dos dois lados
sozinho consegue escrever um caminho arbitrário — o que mudou é que a api
passou a dizer QUAL raiz, em vez de haver uma só e a resposta ser implícita.

**Duas variáveis e não uma, e sem herança entre elas.** A raiz gerenciada é
nomeada por `workspace_dir_name` (UNIQUE) e a base é nomeada pelo usuário. O
mesmo nome aponta para pastas diferentes nas duas, e nada no schema impede a
colisão — é o primeiro motivo pelo qual o ADR 0141 recusou conflar
`BRABO_PROJECTS_BASE` com `PROJECT_WORKSPACES_HOST_DIR`, e ele vale idêntico
aqui. Por isso `BaseDeProjetosNaoConfiguradaError` é classe PRÓPRIA, com o
mesmo molde de `RaizDeWorkspacesNaoConfiguradaError`: origem `infra`, mensagem
nomeando a variável, nenhum container tocado. Cair na outra raiz por omissão
montaria a pasta de OUTRO projeto, e o container subiria — com o código errado
dentro, sem nada indicando por quê.

**Três variantes e não duas.** `indisponivel` não é um `null` disfarçado: é o
estado em que nenhuma raiz DESTE servidor alcança a pasta, e ele tem dois
consertos diferentes. Projeto `runner` (a pasta está na máquina do usuário — o
conserto é o `brabo-runner`, do lado de lá) e projeto `mounted` LEGADO criado
antes da base (o conserto é mover a pasta). Um `null` mandaria quem opera para
o lugar errado metade das vezes. A pasta que É a própria base cai aqui também,
em vez de virar segmento vazio: `<raiz>/` montaria a base inteira — a pasta de
todos os projetos montados — dentro do container de um só.

**A lista de modos que o broker atende é de PERMITIDOS**, não de recusados
(`container`, `mounted`). Um modo novo no enum da api nasce recusado, com
mensagem, em vez de nascer silenciosamente aceito e cair na composição sem raiz
que o resolva.

**Três barreiras sobre a concatenação, não uma.** A api recusa o que não está
sob a base (`segmentoSobABaseDeProjetos`); `packages/docker-port` recusa o
segmento que não é relativo (`segmentoDeProjetoValidado`: `..`, absoluto,
vazio, barra dupla, NUL); e o resultado de `raiz + segmento` ainda passa por
`raizDeProjetoValidada` antes de virar `-v`, como sempre passou. Validar o
segmento e não validar a concatenação seria confiar na aritmética de strings —
e a validação do lado do broker existe justamente porque ele não pode
pressupor que a api esteja correta.

**Consequência do lado da api: a ramificação de `container_start` passa a ser
por DESTINO.** `container` e `mounted` vão ao broker; só `runner` vai ao
runner. E `container_stop`/`container_remove` mudam junto, obrigatoriamente:
subir no servidor e pedir para parar na máquina do usuário deixaria de pé, sem
forma de parar, o que está de pé.

**`mounted` ELEGE a imagem, como `container`.** Não é simetria: é o único
desenho que funciona deste lado. O broker compõe a partir de
`artifact.project_image`, indo BUSCÁ-LO na api — uma eleição da Infra que não
fosse gravada nesse artefato seria inerte, e o container subiria com a imagem do
Arquiteto enquanto o payload aprovado pelo humano diria outra coisa. É
literalmente o argumento do ADR 0133, aplicado a um segundo modo. O caminho do
runner pode ler a vigente porque lá a api MANDA os campos da spec pelo canal; o
artefato não é a fonte que o outro lado consulta.

## Consequences

O modo Pasta montada deixa de exigir um `brabo-runner` conectado para ter
container. Era essa exigência que tornava incoerente a sequência que o plano do
dono do produto pede — escolher `mounted` na criação, e o container subir antes
dos dev agents.

**`runner` fica sozinho no caminho do runner**, e isso é o desenho, não uma
sobra: o broker (e o servidor) continuam sem enxergar a pasta dele. `container`
continua sendo o único modo que sobe container no servidor **sem** depender de
uma base configurada pelo operador; `mounted` sobe no servidor quando ela
está.

**Custo declarado 1: uma instalação pode ter uma raiz e não a outra.** Isso é
estado legítimo, e cada operação diz qual falta em vez de as duas caírem numa
recusa genérica. O preço é duas classes de erro onde poderia haver uma com
parâmetro — aceito, porque quem lê o erro é quem precisa saber QUAL variável
definir.

**Custo declarado 2: o broker agora conhece um segundo formato de segmento.**
`gerenciada` é um nome sem `/`; `montada` é um caminho relativo, que pode ter
níveis. `nomeDeWorkspaceValidado` (que serve ao NOME do container e recusa `/`
de propósito) deixa de servir para validar caminho, e nasce
`segmentoDeProjetoValidado` ao lado dela. São duas perguntas que passaram a ter
respostas diferentes — "como se chama o container" e "onde fica a pasta" — e
tê-las com uma função só era o que funcionava enquanto elas coincidiam.

**O que este ADR NÃO decide.** Não materializa pasta nenhuma (é a validação
diferida, PR vizinha). Não muda o portão da imagem — RN-105 já vale para os três
modos desde a RN-494/ADR 0135. Não muda quem PROPÕE `container_start`: o Infra
Lead segue podendo propor para um projeto sem runner conectado e sem imagem
decidida, a lacuna declarada desde a RN-494. Não altera a contagem de operações
do broker: continuam **cinco**, e uma sexta segue sendo decisão de produto com
ADR. E não publica a imagem do broker no GHCR — as quatro do ADR 0119 seguem
sendo quatro.

Referencia [0130](0130-broker-de-container.md) (o broker compõe a spec),
[0133](0133-infra-elege-imagem-do-roteamento.md) (a eleição precisa ser
gravada para ter efeito), [0137](0137-o-runner-sobe-o-container-do-projeto.md)
(o outro caminho de execução) e [0141](0141-base-unica-dos-projetos-montados.md)
(a base que tornou isto possível). Nenhum deles é editado.
