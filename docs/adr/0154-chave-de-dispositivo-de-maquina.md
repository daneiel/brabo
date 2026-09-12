# 0154 — A chave de dispositivo de máquina

## Status

**Proposed.** Primeira das duas decisões da
[FASE 30](../explanation/fase-30-runner-por-maquina.md). A outra é o
[ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md), e ela depende desta:
sem identidade de máquina, não há o que o instalador registre.

## Context

A direção de produto é a da [FASE 29](../explanation/fase-29-instalacao-de-uma-linha.md):
instalar o Brabo numa linha e ter o agente local **de pé**. O instalador já
chega perto — desde a RN-531 ele baixa o binário, confere contra o
`checksums.txt` assinado e o instala com `install -m 0755`, sem `chmod`
manual — e então **para**. A última linha da saída dele diz por quê, com
todas as letras:

> Não pareia o agente local com um projeto: o binário e a base ficam prontos
> aqui, mas a chave de dispositivo e o `brabo-runner.config.json` continuam
> vindo da tela do projeto (ADR 0118).

O binário fica no disco, parado. Quem quiser usá-lo volta à tela do projeto,
escolhe a pasta, e termina colando no terminal o comando que
`apps/web/src/lib/runner-bootstrap.ts:398` monta —
`chmod +x ./brabo-runner && ./brabo-runner`. O comentário logo acima dele
explica por que a **tela** não consegue eliminar esse passo, e o argumento
está certo:

> Uma página web não executa binário na máquina de ninguém: este passo é
> humano em qualquer desenho, e o que dá para fazer é encolhê-lo a UMA linha
> copiável.

O que o argumento não cobre é que **o instalador não é uma página web**. Ele
roda no terminal, com TTY, e já pergunta — é o desenho inteiro do
[ADR 0150](0150-instalador-de-uma-linha.md), que recusa `curl | sh` justamente
para poder perguntar. O passo humano é inevitável na tela e evitável ali.

### O que trava não é o binário: é a identidade

`brabo-runner service install` existe desde a RN-518
([ADR 0147](0147-o-agente-local-declara-o-que-sabe-fazer.md) ponto 5) e
instala o agente como serviço de usuário (`systemd --user`/`LaunchAgent`).
Ninguém o chama do `install.sh`, e não é esquecimento: ele precisa de um
`projectId` e de uma chave de dispositivo, e **na hora da instalação não
existe projeto nenhum** — nem conta, nem workspace. O `.env` acabou de nascer,
o compose acabou de subir, ninguém se cadastrou.

A FASE 29 mediu o acoplamento e o nomeou: *"um runner por projeto está
imposto em cinco lugares independentes"*. Medidos de novo aqui, com
`arquivo:linha`:

| # | onde | o que impõe |
|---|---|---|
| 1 | `apps/engine/lib/engine_web/channels/terminal_channel.ex:204` | o tópico é `terminal:<projectId>` |
| 2 | `apps/engine/lib/engine_web/channels/runner_socket.ex:73` | o socket id é `runner_socket:<kind>:<project_id>:<user_id>` |
| 3 | `Engine.Runners.SocketTicket` (`runner_socket_tickets`) | o ticket carrega `project_id` e o join exige que bata |
| 4 | `apps/api/src/db/schema/auth.ts:325-326` | `runner_device_keys.project_id` é `NOT NULL` |
| 5 | `apps/runner/src/servico.ts:264,391` | a unit é `brabo-runner-<projectId>.service` |

### Três dos cinco não precisam mudar, e essa é a descoberta desta decisão

O recorte óbvio seria atravessar os cinco. Medindo o socket, ele encolhe.

`RunnerSocket.connect/3` (`runner_socket.ex:33`) autentica por **ticket**, e o
ticket é pedido à api por projeto. O `project_id` chega em `socket.assigns` e
o consumo atômico acontece no `join`, contra o `project_id` do tópico. Ou
seja: os itens 1, 2 e 3 descrevem uma **conexão**, não um processo. Um único
processo que abra **N conexões** — uma por projeto que ele atende — satisfaz
os três byte a byte, sem tocar o tópico, o socket id, o ticket, nem a recusa
de segundo runner no mesmo projeto, que continua sendo a garantia que é hoje.

O que sobra é o que é genuinamente **do processo**: a credencial com que ele
pede os N tickets (item 4) e a unit que o mantém de pé (item 5). São esses
dois que este ADR move.

### E hoje a credencial nasce presa a um projeto

`runner_device_keys.project_id` é `NOT NULL` (`auth.ts:325-326`), e a chave é
gerada pelo navegador **dentro da tela de um projeto**
([ADR 0118](0118-configuracao-do-runner-pelo-navegador.md), RN-464..466,
RN-475). Uma máquina com três projetos em modo `runner` tem três chaves, três
pastas com `brabo-runner-device-key.jwk.json`, três units de serviço e três
processos — e a pessoa passou três vezes pelo mesmo fluxo de navegador para
descrever **uma** máquina.

## Decision

**A identidade do agente local passa a ser da MÁQUINA, não do projeto.**

### 1. `runner_device_keys.project_id` vira nullable, e `NULL` significa máquina

Não nasce tabela nova. Uma chave de máquina é uma chave de dispositivo com
`project_id NULL` — mesma tabela, mesma coluna `public_key_jwk`, mesmo
`kid` gravado dentro da JWK privada (RN-475), mesma revogação.

Tabela irmã foi considerada e recusada: `PatAuthGuard` acha a pública pelo
`kid` e não precisa saber de que espécie ela é; duas tabelas fariam **duas**
buscas, e a segunda seria esquecida exatamente uma vez. A RN-519 (listagem) e
a RN-520 (revogação que alcança a conexão viva) continuam valendo sem código
novo, com uma consequência declarada abaixo.

`NULL` e não um sentinela (`project_id = '00000000-…'`): a FK é real e um
sentinela exigiria uma linha falsa em `projects` para satisfazê-la.

### 2. Uma chave de máquina vale para os projetos do usuário, resolvidos na hora do ticket

`POST .../runner-ticket` continua sendo **por projeto** — é ele que carrega o
`project_id` do item 3. O que muda é o que ele aceita como credencial: uma
chave de máquina do **mesmo usuário** passa a valer para qualquer projeto em
que esse usuário alcance o papel que a rota já exige. Nenhum teto novo, e
nenhum afrouxado: a autorização continua sendo a de sempre, resolvida contra
o projeto pedido.

O que a chave de máquina **não** faz é ampliar alcance: ela não dá ao runner
nada que o usuário dono dela já não tivesse. Ela troca *"uma credencial por
projeto"* por *"uma credencial por máquina"*, e só.

### 3. O runner descobre os projetos que atende, e não os adivinha

Rota nova, `GET runner/projects` (o mínimo da rota é `developer`, o mesmo de
`runner-ticket`): os projetos do usuário em `execution_mode: runner`, com o
`workspace_dir_name` e o estado de verificação de cada um. O runner a consulta
no start e abre uma conexão por projeto que ela listar.

Ele **pergunta** em vez de varrer a base: a base é do usuário e pode ter pasta
que não é projeto nenhum, e adivinhar por nome de pasta é a classe de erro que
o [ADR 0141](0141-a-base-unica-dos-projetos-montados.md) recusou ao proibir
`PROJECT_WORKSPACES_HOST_DIR` como base.

### 4. A unit de serviço passa a ser UMA por máquina

`brabo-runner.service` / `dev.brabo.runner`, sem `projectId` no nome. O
argumento original de `servico.ts:32-38` — *"nomear pela pasta permitiria
instalar duas units que nunca podem estar de pé ao mesmo tempo"* — some junto
com a premissa: com um processo por máquina não há duas.

`Restart=on-abnormal` fica byte a byte, pelo motivo da RN-518: exit 1 é recusa
fatal de join ou teto de tentativas esgotado, e reiniciar seria o laço que o
CLI recusa fazer sozinho.

### 5. As units por projeto continuam funcionando, e a conversão é dita

Binário novo com unit velha instalada não quebra, e `status` responde sobre as
duas. Quem tiver três units por projeto continua com três processos até rodar
`service uninstall` em cada uma — e o `status` da unit de máquina **diz** que
elas existem, em vez de deixar seis processos disputando três projetos em
silêncio.

> **Corrigido na implementação (RN-545).** Este ADR dizia que `service install`
> **sem `--project`** instalaria a unit de máquina. Medido, não dá: a ausência
> da flag **já tem significado** — `resolverProjeto` cai no
> `brabo-runner.config.json` da pasta, e o caminho normal de quem usa o produto
> hoje é rodar `install` sem flag nenhuma de dentro da pasta que o navegador
> configurou. Ao pé da letra, a regra converteria **em silêncio** a instalação
> de quem já usa o produto — o oposto do que este mesmo ponto promete. O
> discriminador é a flag **`--machine`**, explícita. Editado em vez de
> contrariado porque este ADR ainda é `Proposed`: ADR **aceito** nunca se
> edita, o novo referencia o antigo.

## O que este ADR recusa explicitamente

- **Fundir os tópicos num `runner:<userId>`.** Seria atravessar os itens 1, 2
  e 3 para não ganhar nada: N conexões já os satisfazem, e a recusa de segundo
  runner por projeto — que é uma garantia real — mora justamente ali.
- **Uma chave de máquina que atravesse usuários.** `runner_device_keys.user_id`
  continua `NOT NULL`. Máquina compartilhada por duas pessoas são duas chaves,
  e isso é a resposta certa: a credencial descreve **quem** age, não só onde.
- **Descobrir projetos pelo disco.** Ver o ponto 3.
- **Revogação por chave.** A RN-520 alcança `{projeto, usuário}` por
  construção, e este ADR não a muda — só torna o custo dela maior, o que está
  em Consequences.
- **Qualquer exceção em `decide.ts`.** Os cinco tetos absolutos, o escopo
  léxico do [ADR 0055](0055-politica-de-terminal.md) e o piso de auto-aprovação
  da RN-493 ficam como estão. Este ADR move identidade, nunca autoridade.
- **`RunnerReadiness` com flag.** As três pré-condições da RN-507 ficam byte a
  byte, pelo motivo já registrado no ADR 0147 ponto 4: é por uma flag assim
  que a terceira cairia por acidente.

## Consequences

- **Revogar passa a custar mais, e isso estava previsto.** A FASE 29 declarou:
  *"quando a FASE 30 fizer o runner por máquina, revogar passará a derrubar
  todos os projetos daquela máquina. Custo declarado aqui para não ser
  descoberto lá."* É exatamente o que acontece, e a listagem da RN-519 passa a
  precisar dizer de qual espécie é cada chave — uma de máquina não é
  "a chave do projeto X".
- **Um processo no lugar de N.** Menos memória e menos units, e um ponto único
  de falha onde havia N independentes: o serviço cair tira o agente local de
  **todos** os projetos daquela máquina.
- **O `espelho` e o `workspace_create` não mudam.** Os dois são por projeto e
  viajam na concessão do `join` daquela conexão (RN-516, RN-532). Com N
  conexões, cada uma continua recebendo a sua — e o destino de espelho do
  projeto B segue impossível de alcançar pela conexão do projeto A, que é a
  garantia que a RN-515 existe para dar.
- **O fluxo do navegador (ADR 0118) não é removido.** Ele continua sendo o
  caminho de quem já tem uma instalação, e passa a ser o segundo. Decidir se
  ele deve sumir é o que o BRB-031 chama de decisão do mantenedor, e não é
  consequência desta entrega.
- **A capacidade `workspace` (RN-532) ganha um segundo motivo para existir.**
  Ela já dependia do ESTADO (base consentida); com o agente de máquina, é por
  ela que o servidor sabe que aquele processo pode materializar a pasta de um
  projeto recém-criado — que é o "linkar a pasta depois" que esta fase
  persegue.
