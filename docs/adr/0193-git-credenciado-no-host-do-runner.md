# 0193 — O git credenciado roda no HOST do runner; o código roda no container

## Status

**Accepted.** 2026-10-01 (AT-116, história HS-037, épico EP-010, rodada 36;
decisão do dono em 01/10: *"operações de git credenciadas no HOST, código no
container"*). Fecha a metade que a [RN-558](../business-rules.md#rn-558) deixou
declarada como aberta e referencia, sem editá-los, o
[ADR 0130](0130-broker-de-container.md) (a porta de Docker sem `-e` livre), o
[ADR 0145](0145-docker-pre-requisito-do-runner.md) (`RunnerReadiness` e as três
pré-condições do modo `runner`) e o
[ADR 0056](0056-o-engine-trabalha-em-repositorio-remoto.md) (a credencial de
git só no AMBIENTE do processo filho). A prova é a AT-111.

## Context

Medido em `dev` em 2026-10-01, antes de mudar:

- O ÚNICO `exec` do engine que carrega `env` é o `git fetch` autenticado de
  `Engine.Actions.Workspace.RunnerGit.fetch!/3` (`GitAuth.env_de_auth/1`,
  convertido em mapa; `nil` para provider sem token). `TerminalExecutor` chama
  `RunnerRouter.exec/4` e nunca passa `env`. Não existe `push` nem `clone`
  credenciado via `exec` no modo `runner`: o clone da criação de pasta viaja
  em `workspace_create` (RN-532), que já roda no HOST (`criarPastaDoProjeto`).
- `RunnerReadiness` (ADR 0145) exige container `running` REGISTRADO antes de
  qualquer operação de `RunnerGit`, e num projeto `runner` esse registro só
  existe porque o MESMO runner subiu o container — o que seta
  `estado.containerAtivo`. Com ele setado, `tratarExec`
  (`apps/runner/src/index.ts`) roteava TODO comando ao `docker exec`, que não
  tem campo de `env` (ADR 0130). Desde a RN-558 esse par (`env` presente,
  container ativo) era RECUSADO com a marca
  `credencial-nao-atravessa-o-container`: o caminho COMUM do fetch autenticado
  terminava em recusa nomeada, nunca em sucesso.
- A pasta é a MESMA dos dois lados: `tratarContainerStart` monta
  `estado.dir` (a raiz confirmada pelo runner) em `/work`
  (`DockerViaCli.start`, `${raizDoProjeto}:/work:rw`, `PONTO_DE_MONTAGEM` em
  `packages/docker-port/src/docker-port.ts`), e o `cwd` de todo `exec` é
  validado dentro de `estado.dir` (`validarCwdDentroDaRaiz`) e traduzido para
  `/work/...` só quando vai ao container. O `.git` que um fetch atualiza no
  host é o que o container enxerga.

As duas saídas vetadas seguem vetadas: um `-e` livre na `DockerPort` (o ADR
0130 recusou) e uma flag "pula container" em `RunnerReadiness` (derrubaria a
terceira pré-condição do ADR 0145 para o `exec` inteiro).

## Decision

1. **A operação de git credenciada roda no HOST do runner, mesmo com container
   ativo.** O comando do dev agent continua indo ao `docker exec`. A
   credencial chega ao processo filho pelo caminho que sempre funcionou:
   `apps/runner/src/exec.ts` mescla o `env` sobre `process.env`.

2. **O discriminador é uma MARCA EXPLÍCITA posta pelo engine, não o `env`.**
   O payload `exec` ganha `gitCredenciado: true`, opcional, e quem o põe é
   `RunnerRouter.exec_git_credenciado/5`, chamada por UM ponto
   (`RunnerGit.despachar/5`, a partir de `fetch!/3`, só quando há credencial).
   A função exige `env` não vazio por guarda de cláusula. O runner roda no host
   SÓ com a CONJUNÇÃO (marca `true` literal **e** `env` não vazio).

   Por que não o `env` sozinho, que já existia: com ele, qualquer `exec` que
   chegasse com um `env` escaparia do container — o `env` viraria a porta de
   saída da contenção que o ADR 0145 pôs para o código. Com a marca, a saída é
   uma decisão NOMEADA de um único chamador do engine, e um `env` sem a marca
   não ganha o host. A marca também não basta sozinha: sem credencial não há o
   que proteger, e o comando segue o roteamento de sempre.

3. **Nenhuma porta do ADR 0130 muda.** `DockerPort.exec` continua sem campo de
   `env`; a imagem, a rede, o mount e o broker não são tocados.
   `RunnerReadiness` fica byte a byte: a marca muda ONDE o runner executa, nunca
   SE o engine despacha — a pré-condição do container `running` registrado
   continua valendo para o fetch também.

4. **A recusa da RN-558 continua existindo, e encolhe para um caso.** O par
   (`env` presente, container ativo) SEM a marca segue recusado com a mesma
   marca de protocolo e origem `politica`. Nenhum chamador do engine produz
   esse par hoje; na prática ela aparece por DESCOMPASSO de versão — um
   `brabo-runner` anterior a este ADR não lê a marca, roteia o fetch ao
   container e recusa como antes. Por isso a mensagem de
   `Engine.Runners.CredencialDeGit.mensagem/2` passa a dizer o conserto
   (atualizar o runner, ou parar o container), em vez de "a metade que falta
   não existe". O texto da recusa do runner também muda (diz "SEM a marca de
   git credenciado"), e a fixture
   `apps/runner/fixtures/exec-result-recusa-de-credencial.json` muda junto.

5. **A invariante de log continua.** Nem a recusa nem o log do caminho host
   citam nome ou valor de variável do `env` — a recusa dá a CONTAGEM, e o log
   do host acrescenta só `[git credenciado, no host]`. O texto do comando
   continua sendo logado como sempre (ele carrega o helper do ADR 0056, que
   referencia as variáveis por nome, mas nunca o valor — isso não muda aqui).

## Consequences

- O fetch/clone de repositório remoto AUTENTICADO em modo `runner` passa a
  funcionar com o container de pé, que é o caminho comum. A RN-558 deixa de
  disparar nele.
- **Runner antigo + engine novo:** o runner ignora a marca e recusa com a marca
  da RN-558; o engine diz "atualize o runner". **Runner novo + engine antigo:**
  o engine não manda a marca, e o runner recusa como antes. Nenhuma combinação
  volta ao descarte silencioso.
- O git credenciado roda com o usuário e o `git` do HOST, não com os do
  container. Os arquivos que o fetch escreve em `.git` nascem com o dono do
  processo do runner — que é o dono da pasta montada. **Não medido:** um
  container de projeto `runner` cujo `--user` não seja esse dono veria o
  `.git` atualizado com outro dono; hoje a spec que a api manda ao runner
  (`EspecificacaoDeContainerParaRunner`) não tem `usuario`, então o container
  roda com o usuário da imagem, e o efeito não foi exercitado contra Docker
  real.
- A RN-558 listava esta opção como a que "quebraria o invariante de que o
  trabalho acontece dentro do container". A decisão do dono a aceita com
  esse preço escrito: o que sai do container é a CONVERSA do `git` com o
  remoto (o fetch credenciado), nunca o código do projeto — `npm install`,
  testes e build do dev agent continuam no `docker exec`. O que o fetch traz é
  objeto de git, e só vira arquivo de trabalho num `checkout`/`worktree add`
  que não carrega credencial e segue o roteamento de sempre.
- O host precisa ter `git` instalado. Ele já precisava: o `workspace_create`
  (RN-532) e o caminho sem container sempre rodaram `git` no host.
- A marca é uma segunda constante de protocolo no par `exec`, ao lado do
  `env`. Ela só viaja quando é `true` (o payload do terminal comum fica byte a
  byte o de antes), e o runner aceita só o booleano `true` — qualquer outro
  valor é ausência.
- Fica de fora: `push` credenciado pelo `exec` do runner não existe hoje; se
  nascer, entra pela mesma função (`exec_git_credenciado/5`), nunca por um
  segundo caminho de marca.
- A prova (AT-111) troca a recusa por sucesso nos dois lados:
  `apps/runner/src/index-handlers.spec.ts` (com container ativo e a marca, o
  helper real do `git` recebe a credencial e um `git fetch origin` real sucede
  no host, sem `docker.exec`; `env` sem a marca segue recusado) e
  `apps/engine/test/engine_web/channels/credencial_no_runner_test.exs` (pelo
  `TerminalChannel` real, o fetch vai marcado e a corrente termina em
  `{:ok, _}`). Os testes ExUnit não rodaram no ambiente desta entrega
  (`repo.hex.pm` respondia 403); quem os prova é o CI.
