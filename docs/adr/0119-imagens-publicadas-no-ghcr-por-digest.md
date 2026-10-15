# ADR 0119 — Imagens publicadas no GHCR a cada tag final, e o overlay de produção preso por digest

- **Status:** aceito
- **Data:** 2026-08-29
- **Referências (sem editar):** [ADR 0025](0025-fase5-deploy-kubernetes-kustomize.md) e
  [ADR 0027](0027-fase5-backup-hardening-release.md) (os dois registraram
  "publicar a imagem num registry" como fora de escopo — este ADR é o que
  fecha isso), [ADR 0030](0030-politica-de-branches-mecanizada.md) (as
  exceções de push que esta decisão deliberadamente não amplia),
  [ADR 0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md) (a versão gravada no
  artefato, que é por que `VERSION` fica separada de `TAG`).

## Contexto

O `release.yml` construía as quatro imagens de produção a cada tag final com
`load: true` e `push: false`, e dizia isso num comentário: o build existia
para provar que a tag era **construível**, e a publicação "entraria quando o
registry fosse decidido". Enquanto isso, o overlay de produção apontava para
`ghcr.io/OWNER/brabo-*` com `newTag: REPLACE_WITH_DIGEST` — um marcador de
dono e um marcador que passo nenhum jamais substituía.

A consequência não era cosmética. Enquanto isso valeu, **"deploy de produção
executável de ponta a ponta" era falso**, e tudo o que estava atrás disso
continuou atrás: um rollout real, uma restauração ensaiada contra imagens de
produção e a história de assinatura de código do binário do runner (que
precisa de um artefato publicado para assinar). Uma revisão externa do
repositório a classificou como a dívida declarada mais cara, e este ADR é
esse item.

Um segundo defeito apareceu no caminho: o bloco `images:` do overlay listava
**três** imagens, não quatro. `brabo-backup` nunca era remapeada, então o
CronJob de backup herdava `brabo-backup:prod` da base — um nome que não
resolve em registry nenhum. O ambiente que mais precisa do seu backup teria
sido aquele cujo pod de backup nunca subia. A CI nunca pegou isso porque a
checagem do overlay valida que o overlay **constrói**, e uma imagem com nome
local constrói sem problema.

## Decisão

**1. O `release.yml` publica as quatro imagens no GHCR a cada tag final.**
O login usa o próprio `GITHUB_TOKEN` do job com `packages: write` — nenhum
segredo novo para rotacionar, e o escopo morre com o job. Os pacotes são
**públicos**: o código já é público no mesmo repositório, segredos nunca são
gravados numa imagem (as quatro chaves irmãs recusam subir com valor de
exemplo, RN-114), e pacotes públicos mantêm o overlay de produção em
"puxa e roda", sem `imagePullSecret` para criar, referenciar e rotacionar em
cada namespace.

**2. O prefixo do registry é uma variável do bake, não um segundo bakefile.**
`REGISTRY` tem default `""`, então o `ci.yml` continua construindo os nomes
locais curtos (`brabo-api:prod`) que ele varre e testa no smoke; o
`release.yml` define `ghcr.io/<owner>/`. A barra final mora **no valor** — um
prefixo vazio tem de produzir exatamente o nome antigo, e qualquer separador
fixo na interpolação teria quebrado o `ci.yml`. `OUTPUT` segue a mesma
forma: `type=docker` (carrega local) por padrão, `type=registry` (push) para
a release. `type=registry` não é otimização — é o único modo em que o bake
devolve `containerimage.digest`, porque **o digest nasce do push**.

**3. O que cada tag publicou fica registrado por DIGEST em
`.release/images.json`.** As tags (`3.2.0`, o sha do commit) continuam sendo
publicadas: servem para conversa humana e `docker pull` manual. Elas nunca
são o que um manifesto referencia — uma tag mutável apontando para conteúdos
diferentes ao longo do tempo destrói o rollback determinístico e deixa dois
pods do mesmo ReplicaSet rodarem binários diferentes, que é o que o próprio
comentário do overlay dizia desde a Fase 5.

**4. O arquivo é asset da GitHub Release, e entra no repositório pela PR do
CHANGELOG.** Ele **não** ganha uma terceira exceção de push. A política de
branches tem exatamente duas (tags pelo bot de release, `.release/gate.json`
pelo bot do gate), e um mecanismo que precisa de exceção nova cada vez que
cresce é um mecanismo que deixa de ser política. O asset da release é a cópia
autoritativa, disponível no instante em que a tag existe; a cópia versionada
chega pela PR que o `release.yml` já abre contra a `dev`.

**5. O overlay mantém o marcador; `make imagens-do-release` aplica o
digest.** O repositório não declara qual release está em produção — quem faz
o deploy decide isso, quando faz o deploy. O que o repositório guarda é o
registro do que cada tag publicou e a ferramenta que o aplica. A ferramenta é
`kustomize edit set image`, não `sed`: o kustomize sabe que
`name=repo@sha256:…` significa `newName` + `digest` e que `newTag` tem de
sair, enquanto um `sed` acertaria o texto e erraria o schema.

**6. `brabo-backup` entra no bloco `images:` dos overlays**, em prod e em
staging.

## Consequências

- O overlay de produção nomeia um dono real (`ghcr.io/daneiel/*`) em vez de
  um marcador, e as suas quatro imagens resolvem para algo que existe.
- **Aplicar os digests reescreve o arquivo do overlay inteiro.** O
  `kustomize edit` faz ida e volta no YAML: reordena chaves e solta
  comentários. Isso é aceitável numa operação de hora de deploy e é por isso
  que o resultado explicitamente **não** é para ser commitado — registrado no
  próprio comentário do arquivo e no runbook, para a próxima pessoa não
  descobrir isso num diff.
- Uma release agora falha se qualquer um dos quatro alvos voltar sem digest.
  É deliberado: três imagens novas e uma velha em produção é pior que release
  nenhuma, e nada num arquivo parcial diria que faltou uma imagem. A mesma
  disciplina do `embed` em lote (ADR 0075) — uma resposta parcial é
  indetectável depois.
- **Ainda não feito, e não alegado:** nada faz deploy sozinho. Não há
  ambiente para onde fazer deploy, `DEPLOY_ENABLED` continua não existindo, e
  o gate `platform` fica `planned` (ADR 0091/0092). Este ADR torna o overlay
  de produção *executável*; ele não o executa.
- **Também não feito: assinar ou atestar as imagens.** Nenhuma assinatura
  cosign, nenhuma proveniência SLSA. Isso pertence ao item de assinatura de
  código dos binários do runner (ADR 0112), bloqueado na mesma ação do
  operador — obter uma identidade de assinatura.
- A primeira execução real deste caminho é a **próxima tag final**. Como o
  `build-runner-binaries.yml` (ADR 0112), o workflow é disparado por tag,
  então não pode ser provado por uma PR. A lógica pura (`images-manifest.ts`,
  `aplicar-imagens.ts`) é coberta por testes; a renderização do bake foi
  conferida com `docker buildx bake --print` nos dois modos; o caminho do
  `kustomize edit` foi executado de verdade contra o overlay de prod com um
  manifesto sintético. O que teste nenhum dá é o GHCR aceitando o push, e
  isso espera a tag.

## Alternativas consideradas

**O bot de release reescrever o `kustomization.yaml` e fazer push.**
Recusada por dois motivos: abriria uma terceira exceção de push numa política
que tem duas, e deixaria uma tag decidir sozinha o que está em produção.

**Pacotes privados com um `imagePullSecret`.** Recusada: acrescenta um
segredo para criar, referenciar em cada namespace e rotacionar, para
esconder uma imagem construída de código público que não carrega segredo. O
custo é real e contínuo; o benefício, aqui, não é.

**Prender pela tag de versão em vez do digest.** Recusada pelo motivo que o
overlay já tinha escrito antes de este ADR existir, e que o teste agora
impõe: nenhum argumento emitido por `argumentosDeSetImage` pode carregar uma
`:tag`.
