# 0044 — Adoção de repositório existente, e o plano como portão

## Contexto

O primeiro dogfooding (Fase 10) só rodou porque alguém inseriu linhas à
mão. O achado P1 #1, verbatim de
`docs/missions/dogfooding-mission.md:638`:

> O produto não sabe apontar um projeto para repositório existente.
> `createRepo` é incondicional; `getRepo` existe e não é chamado por
> nenhum caso de uso; o DTO não tem campo para `externalId`.

O procedimento da missão (`:102-134`) descreve o contorno: `INSERT` em
`project_repositories` e em `repo_bootstraps`, esta última "marcada como
convergida — para o produto não tentar retomar bootstrap nenhum". Ou
seja: para usar o Brabo num repositório que já existia, era preciso
mentir para o banco sobre um bootstrap que nunca rodou.

Três coisas do que já existia moldaram a solução:

1. **O dry-run já estava escrito, sem ninguém ter chamado assim.**
   `BootstrapStep.check(ctx)` (Fase 2,
   [ADR 0005](0005-repo-bootstrap-idempotent-steps.md)) relê o estado
   REMOTO e devolve as mutações ainda pendentes. É chamado a cada
   execução, e é isso que dá idempotência e retomada. Um plano é essa
   mesma lista **sem** chamar `run()`.
2. **Proteção de branch, no contrato, é um booleano.** O
   [ADR 0028](0028-protecao-de-branch-divergencia-entre-providers.md)
   recusou deliberadamente dar configuração a `ProtectBranchInput`
   ("criaria um vocabulário que só um dos providers sabe honrar, e o
   outro teria de ignorar em silêncio"), deixando um `ProtectionPolicy`
   normalizado para quando houvesse necessidade real. O contrato promete
   só o observável: `listBranches` devolve `protected: true`.
3. **O bootstrap já não sobrescrevia proteção.**
   `bootstrap-steps.ts:112` pula branch com `protected: true` desde a
   Fase 2. O que faltava não era a guarda — era **tornar visível e
   explicitamente aprovado** o que ele faria.

Vale registrar que o ADR 0028 **não** diz "nunca sobrescrever proteção
existente". Essa regra nasce aqui; 0028 é a razão de ela só conseguir
operar no nível booleano.

## Decisão

### `origin` como eixo, nas duas tabelas

`project_repositories.origin` e `repo_bootstraps.origin` (`created` |
`adopted`), gravados explicitamente por quem escreve — não pelo default
da coluna, para que adoção seja escolha visível no código e não ausência
([RN-046](../business-rules/custo.md#rn-046)). O backfill da migração `0031` é
cego de propósito: adoção não existia antes dela, então toda linha
pré-existente foi criada pelo Brabo por definição, e não há caso a
classificar errado — diferente do backfill dirigido da `0026`.

### O plano mora no cursor, não em tabela nova

`repo_bootstraps` ganha `plan` (jsonb), `plan_generated_at`,
`plan_decision`, `plan_decided_at`, `plan_decided_by`.

O plano é **snapshot**, não log: mesmo dono, mesma chave e mesmo tempo
de vida do cursor que o ADR 0005 já definiu. Uma tabela própria
sugeriria histórico consultável de planos antigos — e o histórico já
mora em `session_events` e `proposed_actions`, em duas narrativas que
não precisam de uma terceira.

### O portão fica ANTES do runner

`plan_decision` nulo é o estado que importa: plano gerado, nada
decidido, **nada roda**. Não há filtro dentro do executor — o
`BootstrapRunner` é o da Fase 2, extraído verbatim (128 linhas
conferidas byte a byte) para poder ser compartilhado, e simplesmente
não é chamado. Somado ao guard de `:112`, não existe caminho de código
que proteja uma branch fora de plano aprovado
([RN-045](../business-rules/custo.md#rn-045)).

Aprovar é **tudo-ou-nada**: aprovação seletiva quebraria a cascata
`dev←main, qa←dev, rc←qa` (aprovar `qa` sem `dev` é insatisfazível) e
exigiria reescrever o runner. O que roda é o plano **re-derivado** pelo
`check()` no momento da execução — igual ou menor que o exibido.

**Correção durante a implementação:** a primeira versão prometia MENOS
do que executaria. `protect_branches.check()` lê o estado de agora, e
uma branch que o próprio plano vai criar (`rc`, no fork da Fase 10)
ainda não existe para ser listada como desprotegida — mas existiria na
execução, e seria protegida. O plano ganhou uma passada que projeta as
proteções das branches planejadas. Prometer a mais é aceitável (o runner
pula o que já estiver protegido); prometer a menos anularia a regra
justamente no caso mais comum de adoção.

### "Adotar como está" não adultera o cursor

Dispensar o bootstrap registra `plan_decision = 'as_is'` e um evento —
e deixa o cursor onde está. Mover o cursor para "último passo, done"
seria transformar o seed manual da Fase 10 em comportamento oficial: o
cursor diria que seis passos rodaram quando nenhum rodou. Quem torna o
projeto operável é a decisão registrada, que `deriveProvisioningStatus`
respeita. O plano fica guardado como evidência do que deliberadamente
não foi aplicado.

Daí também o status novo `awaiting_plan_decision`: sem ele, um projeto
adotado ficaria `provisioning` para sempre, com a UI fazendo poll de um
trabalho que não existe.

### Rota separada, não `mode` no DTO

`POST .../repository/adopt` em vez de um DTO discriminado:
`@RequireRole` e OpenAPI são por rota, `route-surface.spec.ts` classifica
por rota, e as respostas diferem de fato (criar devolve o cursor do
bootstrap; adotar devolve o plano). Um DTO com `@ValidateIf` produziria
esquema fraco no documento gerado — exatamente o que aquele spec existe
para pegar.

### Por que NÃO passa pelo `decide()`/`ProposeActionUseCase`

O pipeline genérico de aprovação decide **por mutação**. Aqui a decisão
é **por plano**: o usuário aprova um conjunto coerente, não catorze
ações uma a uma. Além disso o bootstrap, desde a Fase 2, nasce
`auto_approved` e narra numa sessão dedicada, fora do `decide()` — e
cada mutação aprovada continua virando `proposed_action` quando o runner
roda, então a rastreabilidade não muda de lugar.

## Consequências

- `getRepo` sai de órfão a carga: existia desde a Fase 2, coberto pela
  suite de contrato, e nunca tinha sido chamado por caso de uso nenhum.
- Os erros do provider (404 vs 403) já chegavam distintos; o que faltava
  era a **mensagem dizer o que fazer**, que é oposta em cada caso —
  conferir o identificador contra trocar a credencial. Colapsar os dois
  num "falhou ao adotar" seria o diagnóstico por eliminação que o
  [ADR 0020](0020-destravar-gates-qa-secops.md) proíbe repetir.
- **A suite de contrato dos GitProviders ficou intocada**, e nenhum
  método novo entrou no contrato. Foi critério de aceite explícito, e é
  o que mantém a divergência entre providers no lugar onde o ADR 0028 a
  deixou.
- **Buraco fechado de passagem:** `ProvisionRepositoryUseCase.execute`
  num projeto adotado caía no ramo "os dois já existem" e rodaria o
  bootstrap num repositório de terceiro sem plano. Agora recusa com 409.
- O wizard ganha um passo antes de tudo, e a adoção **pula** o passo de
  política de branches: prometer o template para um repositório que já
  tem política própria seria mentir. Nenhum componente novo de UI além
  da tela do plano.
- A tela do plano renderiza `BootstrapSteps` ela mesma em vez de navegar
  para a `ProvisioningPage` — aquela dispara `provisionRepository` ao
  montar, o que **criaria** um repositório.

## O que fica para depois

- **`ProtectionPolicy` normalizada** (adiada pelo ADR 0028). Enquanto
  não existir, divergência de CONFIGURAÇÃO de proteção é invisível: uma
  branch com proteção parcial conta como desprotegida e pode ser
  sobrescrita — dentro de um plano aprovado. É o achado P1 #2 do
  dogfooding, **não corrigido aqui**.
- **O `rc` que a política da Fase 6 não usa** (achado #3, P2): o
  template continua criando e protegendo `rc`. Fora do escopo da 12a.
- **O aceite contra o fork real**: `adopt-repository.smoke.spec.ts`
  existe, é SOMENTE LEITURA e roda gated por `ADOPT_TEST_REPO` +
  `GITHUB_TEST_TOKEN`. Nunca aprova — aprovar mutaria um repositório de
  verdade, e essa decisão é o portão humano, não um teste. "Projeto
  operável depois" segue como checklist manual.
- **A colheita do dogfooding não existe.**
  `docs/explanation/primeiro-dogfooding.md` é citado pelo CLAUDE.md e
  nunca foi escrito; o que existe é o esqueleto
  `docs/missions/colheita-esqueleto.md`. A fonte citada aqui é
  `docs/missions/dogfooding-mission.md`. O ADR da Fase 10 também segue
  em aberto.
- **Adoção não migra dado nenhum** (issues, PRs históricas) — é acesso e
  política, e só (CLAUDE.md, Fase 12).

Referencia [ADR 0005](0005-repo-bootstrap-idempotent-steps.md), de onde
vem o `check()` que virou dry-run, e
[ADR 0028](0028-protecao-de-branch-divergencia-entre-providers.md), que
define por que "proteção divergente" aqui só pode ser booleana.
