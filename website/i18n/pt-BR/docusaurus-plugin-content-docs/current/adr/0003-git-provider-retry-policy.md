# 0003 — Política de retry para providers remotos

## Contexto

`GithubProvider` e `GitlabProvider` fazem chamadas de rede reais (Octokit
e Gitbeaker) que falham de forma transitória — rate-limit (429), erros
5xx, timeout. As 8 operações do `GitProviderContract` (ver 0001) se
dividem em duas naturezas bem diferentes quanto a reexecução segura:

- Leituras (`getRepo`, `listBranches`) são idempotentes por natureza —
  reexecutar não tem efeito colateral.
- Mutações (`createRepo`, `createBranch`, `protectBranch`,
  `commitFiles`, `openPullRequest`, `mergePullRequest`) não são
  idempotentes de forma genérica (ex.: reenviar `createRepo` após um
  timeout pode colidir com o próprio repositório que a primeira
  tentativa criou, ou disparar um segundo commit) — decidir se/como
  reexecutar depende de contexto que o wrapper de retry não tem.

## Decisão

**Retry automático só em leituras, nunca em mutações.**
`apps/api/src/infrastructure/git/retry.ts` expõe `withRetry(fn,
options)` com "Full Jitter" (algoritmo da AWS: `sleep = random(0,
min(maxDelay, base·2^tentativa))`), `maxAttempts` default 4,
`baseDelayMs` 250, `maxDelayMs` 4000. Só `getRepo`/`listBranches` nos
dois providers remotos passam por `withRetry`; toda mutação chama a
API direto e deixa o erro subir cru na primeira falha — quem chamou
decide se tenta de novo.

**Critério de retry é por provider, não genérico**, via
`shouldRetry: (error) => boolean` passado a cada chamada:

- GitHub (`isRetryableReadError` em `github-provider.ts`): 429, ou
  qualquer 5xx, ou 403 **só quando** o header
  `x-ratelimit-remaining: 0` confirma rate-limit
  (`isRateLimited`) — GitHub sobrecarrega 403 pra permissão negada E
  rate-limit, e só o header distingue os dois; nunca retenta 403 por
  status isolado (retentar uma permissão negada é infinito e inútil).
- GitLab (`isRetryableReadError` em `gitlab-provider.ts`): só
  `GitbeakerTimeoutError` e 500/503/504. Gitbeaker **já** retenta
  429/502 internamente (backoff exponencial sem jitter, até 10
  tentativas) — adicionar retry daqui pra esses códigos dobraria o
  delay total sem ganho; o wrapper só cobre o que o Gitbeaker não
  trata.

**Ressalva conhecida, fora do nosso controle: o retry embutido do
Gitbeaker é por TRANSPORTE, não por operação.**
`defaultRequestHandler` do `@gitbeaker/rest` (`retryCodes = [429, 502]`,
`maxRetries = 10`, delay `2^tentativa · 0.25s`, sem jitter) roda pra
QUALQUER request HTTP que o client faz — GET, POST, PUT, sem
diferenciar leitura de mutação — e os dois valores (`retryCodes`,
`maxRetries`) são constantes internas do módulo, sem nenhuma opção
pública no construtor `Gitlab(...)` pra desabilitar ou reconfigurar
(confirmado lendo `@gitbeaker/rest@43.8.0` — nenhum `requesterFn`
customizável exposto pela classe agregada usada aqui). Na prática, isso
significa que uma mutação do `GitlabProvider` que responda 429 ou 502
**é retentada mesmo assim**, só que pela lib, não pelo nosso
`withRetry` — a garantia "mutação nunca retenta automaticamente" só é
100% verdadeira pro GitHub (Octokit não embute retry nenhum: sem
`@octokit/plugin-retry` nem `plugin-throttling` nas dependências) e,
no GitLab, só é verdadeira pros códigos que o Gitbeaker NÃO trata (400,
403, 404, 422, 500, 503, 504) — 429/502 escapam por fora do nosso
controle. Ver o teste
`GitlabProvider — cenários de HTTP mockados > 429 numa mutação
(createRepo): o Gitbeaker retenta por conta própria`
(`gitlab-provider.contract.spec.ts`), que documenta esse comportamento
real em vez de fingir que não existe, e o teste com **500** (fora da
lista do Gitbeaker) que prova "sem retry" nas duas camadas ao mesmo
tempo.

## Consequências

- Uma mutação do GitHub que falhe por rate-limit ou 5xx rejeita na
  primeira tentativa, sempre — não há retry automático de escrita
  nesta fase. Se isso se mostrar um problema de UX real (ex.: bootstrap
  de Gitflow falhando por rate-limit transitório), a decisão futura é
  sobre retry idempotente por operação específica (ex.: `createBranch`
  poderia checar se a branch já existe antes de reexecutar), não um
  wrapper genérico.
- Uma mutação do GitLab que falhe com 429/502 é retentada pelo
  Gitbeaker (até 10x, ~29s de espera acumulada no pior caso: soma de
  `0.25·(2^10-1)` segundos) ANTES do nosso código sequer ver o erro —
  aceito como limitação de biblioteca, documentada, não escondida.
  Trocar de lib só por causa disso é desproporcional nesta fase; se
  virar problema real (ex.: um `createRepo` duplicado por reexecução
  indevida em cima de rate-limit), a decisão futura é sobre substituir
  `@gitbeaker/rest` por um client HTTP fino que dê controle total sobre
  retry, não sobre tentar contornar o comportamento por fora.
- `withRetry` não tem acoplamento com Octokit/Gitbeaker — é testado
  isoladamente (`retry.spec.ts`) com uma `fn` genérica, e cada provider
  só fornece seu próprio `shouldRetry`.
- O tempo total de espera numa leitura com todas as tentativas
  esgotadas é limitado por `maxDelayMs` (4s) por tentativa, não por um
  teto de tempo total — no pior caso (4 tentativas, cada uma no teto),
  a espera soma até ~12s antes do erro final subir.
