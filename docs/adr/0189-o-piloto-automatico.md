# 0189 — O piloto automático: o modo automático aprova tudo, menos os tetos, o escopo compara com a pasta real de execução, e "Sempre permitir" grava verbo + subcomando

## Status

**Accepted.** 2026-10-01 (AT-259, AT-255, AT-258 e AT-257 — esta fecha a
AT-170 —, história HS-066, épico EP-030, rodada 35; decisão do dono de 01/10,
escrita nas atividades).
Referencia o [ADR 0167](0167-modo-automatico-libera-o-escopo-de-caminho.md)
(o modo automático libera o escopo de caminho) e o
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) (o escopo de
caminho da política de terminal) sem editá-los: o 0167 **não é revogado** — o
modo automático continua liberando qualquer comando, inclusive fora da pasta
—, e o 0055 continua sendo o teto, agora comparado com a pasta onde o comando
RODA.

## Context

O uso real de 2026-09-29 mediu três defeitos de uma mesma política
(`analise-uso-real.md`, itens 9 e 11):

1. **"Sempre permitir" desligava o modo automático.** Os sete dev agents
   receberam a curinga `*: auto_approve` às 06:48:28–34 e, segundos depois,
   ganharam a linha `terminal: auto_approve` gravada pelo "Sempre permitir" de
   dev agent ([RN-509](../business-rules.md#rn-509)). O repositório devolvia a
   regra ESPECÍFICA antes da curinga, com origem `especifica`, e `decide()` só
   reconhece o modo automático com origem `curinga`
   ([RN-603](../business-rules/autenticacao.md#rn-603)). Resultado: 97
   pedidos "comando composto com ao menos um segmento não coberto por allow" e
   37 "escopo" com o modo automático aceso na tela.
2. **O escopo comparava com a pasta onde o comando NÃO roda.** Os 37 "escopo"
   eram todos `/work/...` ou `/tmp`, comparados com a raiz do HOST
   (`/home/<usuario>/projetos-brabo/<projeto>`). Com um container `running`, o
   engine executa o comando DENTRO dele (RN-492/RN-502), em `/work`, e traduz
   o `cwd` de host para `/work` só depois, no `terminal_executor.ex`.
3. **O modo automático não dizia, na tela, o que libera.** O cartão de lote da
   [RN-661](../business-rules.md#rn-661) dizia o que NÃO libera; o toggle do
   card do agente e o `ApprovalCard` tinham frases diferentes, e nenhuma dizia
   que `git commit` e branch local passam.

A atividade AT-259 propunha revogar a parte da RN-603 que libera o escopo. O
dono decidiu o contrário em 01/10: *"a RN-603 NÃO é revogada — como o comando
roda no container, o modo automático segue liberando qualquer comando,
inclusive fora da pasta, desde que seja conservado para que nenhum problema
ocorra com o código que o Brabo estiver rodando"*.

Medido em `dev` antes de mudar (testes que reprovavam no código de hoje):
`decide.spec.ts` (5 casos da raiz no container), `agent-autonomy.repository.spec.ts`
(a específica sombreando a curinga) e `approve-always-action.use-case.spec.ts`
(o cenário medido, ponta a ponta). **Não reproduziu:** o piloto já aprovava
`git commit`, `git checkout -b`/`switch -c`/`branch` e os tipos `git_commit`/
`git_branch_create` com a curinga ligada, e já segurava push/PR/merge/deploy,
`sudo`/`doas`, `container_remove`, `instruction_patch` e paralelismo — a
AT-259 fecha só pela AT-255 e pela tela.

## Decision

### 1. O modo automático é o PILOTO AUTOMÁTICO

A curinga `*: auto_approve` aprova TUDO, inclusive o composto sintetizado do
`permissions.json` e caminho fora da pasta (RN-603, mantida), e `git commit` e
criação de branch LOCAL. Seguem fora, nunca auto-aprováveis: git
push/PR/merge/deploy pelo terminal ([RN-418](../business-rules.md#rn-418)),
`sudo`/`doas`, merge em branch protegida, `container_remove`,
`instruction_patch` e `parallelize`/`raise_max_parallel`. `deny` explícito
continua vencendo, e um `ask` ESCRITO no arquivo continua pedindo — é regra do
usuário, como já era na RN-603.

### 2. "Sempre permitir" não desliga o piloto (a forma mais simples)

A específica `auto_approve` sob a curinga `auto_approve` resolve como a
CURINGA, no MESMO repositório que já resolvia a precedência
(`DrizzleAgentAutonomyRepository.resolve`). Das duas formas que a AT-255
oferecia — não gravar a específica quando há curinga, ou a curinga valer para
as isenções com a específica `auto_approve` —, foi a segunda, por três razões:
ela conserta as linhas JÁ gravadas no uso real (a primeira só evitaria as
próximas); o clique continua gravando a específica, que fica valendo se o
toggle voltar para manual (com o escopo, como sempre); e nenhum caminho novo
nasce — `decide()` não muda de regra, só recebe a origem certa. Específica que
diz OUTRA coisa (`require_approval`, `deny`) continua vencendo a curinga.

`AutonomiaResolvida` ganha `especifica` (o modo da linha específica, quando
existe), e é por ele, e não pelo modo resolvido, que "Sempre permitir" decide
se o padrão do agente já está gravado.

### 3. O escopo compara com a pasta REAL de execução

Com container `running` registrado num projeto `container` ou `mounted`, a
raiz do teto de escopo é `/work` (o ponto de montagem — a pasta e os
`.worktrees` do projeto) mais o `/tmp` do container. O `cwd` de host é
traduzido para `/work` pela MESMA regra do engine (`cwd_para_container/2`):
a raiz vira `/work`, o que está sob ela vira `/work/...`, o que está fora segue
como veio. Em `mounted` a tradução é bijetiva (o bind-mount é a identidade da
pasta). Sem container, a raiz é a pasta do projeto no host, e o `/tmp` do host
fica FORA — ele é da máquina inteira, inclusive do Brabo.

Isto vale para quem NÃO está no piloto — a regra específica `terminal` —,
porque o piloto não passa pelo escopo. `projectScopeRoot` não muda e NÃO se
une a `permissionsFilePath` (RN-478): a raiz do host continua sendo a entrada,
e a raiz no container é DERIVADA dela em `path-scope.ts`. O PISO de
auto-aprovação do container (RN-493) continua só do modo `container`; o campo
novo de `DecideContext` (`execucaoNoContainer`) é ONDE o comando roda, e é
outro.

`runner` fica de fora, de propósito: a escolha host-vs-container é interna ao
runner (ADR 0137), e um runner reiniciado com o container de pé roteia para o
HOST (RN-558) — a api não sabe qual dos dois vai acontecer, e liberar `/tmp`
para quem pode estar no host seria liberar o `/tmp` da máquina do usuário.

### 4. A tela diz o que o piloto libera e o que não libera

UMA lista (`OQueOPilotoLibera`), nos TRÊS lugares onde o modo automático é
ligado: o cartão de lote dos Executores (aberta), o `ApprovalCard` e o toggle
do card do agente (recolhida, sob a frase que já existia). A metade do "não
libera" é o texto que a RN-661 já tinha, reusado; a do "libera" nasce aqui.

### 5. A garantia do dono: a contenção, provada

A condição da decisão — nenhum problema com o código que o Brabo estiver
rodando — não é política, é a contenção do container, e ela é provada de ponta
a ponta em `apps/broker/src/contencao-do-brabo.spec.ts`: o container do
projeto monta UMA pasta, sempre em `/work`, ESTRITAMENTE abaixo da raiz do
broker (gerenciada ou base), sem socket do Docker, sem `--privileged`, sem rede
do host, e segmento vazio/absoluto/com travessia é recusado antes de qualquer
chamada ao Docker. Somado às guardas que impedem a raiz de conter o checkout
(`baseSobrepoeOCheckout` no `preflight.mjs`, testada em
`scripts/dev/base-de-projetos.spec.ts`) e à recusa de executar sem container
(RN-502/RN-507), o comando do piloto não alcança o checkout do Brabo.

### 6. A unidade do "Sempre permitir": verbo + subcomando, por segmento

Decisão do dono de 01/10 (AT-257, que fecha a AT-170 — o ponto 6 do ADR 0055,
deixado aberto lá): o clique deixa de gravar o comando inteiro, byte a byte, e
grava UM padrão por SEGMENTO do comando, na unidade VERBO + SUBCOMANDO
(`npm test`, `git status`); argumento que não é palavra generaliza para o
verbo (`cat src/x.ts` → `cat`); verbo + flag fica EXATO (é a forma, onde os
achados Z/AD dizem que verbo e invocação divergem); e unidade que é prefixo de
um teto da RN-418 (`git remote`, `gh pr`) fica exata, ou some se até o exato o
for. As quatro sub-perguntas da AT-170 ficam respondidas: a unidade é esta; ela
NÃO herda o allowlist de verbos (nenhuma lista de verbos nasce, e a dúvida entre
argumento e subcomando cai do lado estreito); quem grava é o mesmo papel de
hoje; e a precedência com a curinga é a do ponto 2. Detalhe na
[RN-675](../business-rules.md#rn-675).

## Consequences

- O cenário medido em 29/09 deixa de pedir aprovação: curinga + "Sempre
  permitir" segue no piloto (teste de não-regressão em
  `approve-always-action.use-case.spec.ts`).
- A regra específica `terminal: auto_approve` deixa de pedir aprovação por
  `/work/...` e `/tmp` com o container de pé, e passa a pedir por caminho de
  HOST num comando (que dentro do container não existe — o engine traduz só o
  `cwd`, nunca os argumentos).
- **O que a prova da contenção NÃO cobre — declarado, não corrigido aqui (a
  decisão do dono foi descrever, não remendar política):**
  1. No compose de PRODUÇÃO (`docker/docker-compose.prod.yml`) nada no host
     confere que `BRABO_PROJECTS_BASE` não contém a pasta de onde o compose
     roda (o checkout, ou a pasta do `.env`). O `preflight.mjs` só roda no
     `pnpm dev`, e `caminhoDeWorkspaceLocalValido` compara com o `cwd` da
     PRÓPRIA api (`/app`), que nunca é o caminho do host. Com uma base assim,
     um projeto `mounted` cuja pasta seja o checkout monta o checkout em
     `/work` — com ou sem piloto.
  2. Na INSTALAÇÃO, o `install.sh` recusa a base sobreposta à pasta da
     instalação só no consentimento (`consentir_base`), sem teste próprio; um
     `.env` editado depois não é conferido de novo.
  3. No modo `runner`, nada compara a pasta do projeto (ou a base do agente
     local) com um checkout do Brabo ou com a pasta da instalação na máquina
     do usuário — a api compara com o próprio `cwd`, e o `guard.ts` do runner
     só restringe ao `$HOME` no Linux.
  4. `segmentoDeProjetoValidado` (`packages/docker-port`) aceita `.` como
     segmento: `<raiz>/.` passa por `raizDeProjetoValidada` como a própria
     raiz e montaria TODOS os projetos daquela raiz. A api nunca produz `.`
     (o segmento montado sai normalizado, e o gerenciado é
     `[A-Za-z0-9_-]`), então não é alcançável hoje; mas o broker existe para
     não depender de o chamador estar correto. Não alcança o checkout (a
     raiz não o contém), alcança os OUTROS projetos.
  5. A rede `egress` é `bridge`: o container alcança as portas que a máquina
     publica, inclusive as da api e do engine. Arquivos não; serviços, sim —
     atrás de autenticação.
- "Sempre permitir" num composto passa a liberar os PRÓXIMOS compostos com os
  mesmos verbos e subcomandos — inclusive, para verbo sem subcomando (`cat`,
  `rm`, `cd`), o verbo com QUALQUER argumento. É a expansão que a AT-170
  pedia que fosse decidida e não deduzida; fora do piloto o escopo de caminho
  continua limitando onde, e os tetos continuam rodando depois do arquivo.
- `git_push` e `pr_open` TIPADOS não são teto em `decide()`: a ativação semeia
  `auto_approve` para eles por `dev-<modulo>` (ADR 0053) e a curinga também os
  aprova; o que os segura é "Sempre permitir" recusar gravá-los (AT-320) e o
  teto de merge em branch protegida. Não mudou aqui.
