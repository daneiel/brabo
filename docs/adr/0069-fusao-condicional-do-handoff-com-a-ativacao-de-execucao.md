# ADR 0069 — Fusão condicional do aceite do handoff com a ativação de execução

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto:** pedido do usuário — reduzir de dois cliques para um quando
  quem aceita o handoff pro Dev Lead já tem o papel para ativar a execução
- **Estende:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) (o
  Dev Lead como agente endereçável); RN-135/RN-136/RN-137 em
  `docs/business-rules.md` (o card de handoff e o atalho "Ativar execução"
  que esta decisão passa a encadear)

## Contexto

O card de handoff pro Dev Lead, em `SessionPage.tsx`, tem hoje dois botões:
"Aceitar handoff e iniciar dev-lead" (exige `developer`) e "Ativar execução"
(exige `maintainer`, RN-137). São dois cliques porque são duas AUTORIZAÇÕES
diferentes, deliberadamente não alinhadas: quem ativa a execução vira
`session.createdBy` da sessão de execução, e é esse papel que
`ProposeActionUseCase`/`ResolveEffectiveRoleUseCase` resolvem como o EFETIVO
de todo `git_commit`/`git_push`/`pr_open` que os dev agents propuserem dali
em diante (`ExecutionController#activate`, `RequireRole('maintainer')`).
Ativar como `developer` daria dev agents incapazes de abrir PR — a
justificativa original de manter as duas rotas com exigências diferentes, e
ela continua valendo integralmente.

O pedido não é baixar essa exigência. É que, quando quem está na tela JÁ tem
`maintainer`/`owner` — e portanto já poderia clicar os dois botões em
sequência sem topar em 403 nenhum —, o segundo clique não protege nada: só
repete uma decisão que o papel do usuário já autoriza. Para quem só tem
`developer`, o segundo clique continua sendo a única forma de sinalizar "sim,
eu quero que ISTO vire a sessão de execução" — não pode desaparecer, porque
ele nunca teria como ativar mesmo clicando.

## Decisão

**`handleAcceptHandoff` (SessionPage.tsx) encadeia `activateExecution`
automaticamente quando `toAgent === 'dev-lead'` E o papel EFETIVO de quem
aceita — lido do MESMO `useCurrentWorkspaceWithRole()` que já autoriza o
"Auto mode" (RN-153) e as telas de Aprovações/Configurações — é `owner` ou
`maintainer`. Para `developer` (ou papel ainda não resolvido), o fluxo
atual continua INTOCADO: aceitar não ativa nada, e "Ativar execução"
permanece como segundo botão enquanto o card estiver na tela.**

```ts
if (toAgent === 'dev-lead' && podeFundirHandoffComExecucao) {
  await handleActivateExecution();
}
```

Três decisões dentro da decisão:

1. **A checagem é só no CLIENTE — o backend não muda.**
   `POST .../execution/activate` continua exigindo `maintainer` como sempre
   exigiu. A fusão é puramente uma questão de QUANTOS cliques a UI pede para
   chegar no mesmo estado que já era alcançável; um `developer` que
   inspecionasse a rede e chamasse a rota direto continuaria recebendo 403,
   exatamente como hoje. Não há superfície de autorização nova — só um
   atalho que só dispara quando o resultado já era garantido.
2. **`handleActivateExecution` não é duplicado, é REUSADO.** A mesma função
   que o botão "Ativar execução" já chama (RN-137, com `sessionId` como
   `originSessionId`) — que já trata o próprio erro com `mensagemDaApi` e
   nunca relança. Isso importa: se a fusão disparasse e o backend recusasse
   por algum motivo tardio (sessão que virou inconsistente entre o aceite e
   a ativação, por exemplo), o `catch` de `handleAcceptHandoff` NÃO deve
   mostrar "Não foi possível aceitar o handoff" — o aceite já tinha
   funcionado. Reusar a função que já engole o próprio erro (toast próprio)
   é o que garante essa mensagem certa sem duplicar tratamento de erro.
3. **O papel é lido do WORKSPACE, não de um novo endpoint de projeto.**
   Mesma aproximação já usada em `ProjectApprovalsTab.tsx`/
   `ProjectSettingsTab.tsx`/o "Auto mode" desta mesma tela: não existe hoje
   um papel de PROJETO resolvido no cliente, então a pergunta "sou
   maintainer?" já era respondida assim antes desta mudança — não é uma
   fonte nova, é a fonte que já autorizava a exibição de outros controles
   equivalentes.

## Alternativas consideradas e descartadas

- **Sempre fundir, e deixar o clique único falhar com 403 para `developer`.**
  Descartada: o card teria um único botão que, para metade dos papéis, faria
  uma chamada FADADA a falhar por trás de um aceite que tinha funcionado —
  o usuário veria "Papel insuficiente" depois de já ter aceitado o handoff
  com sucesso, uma mensagem confusa presa a uma ação que na verdade deu
  certo. Pior UX que manter os dois botões para quem precisa deles.
- **Perguntar ("Deseja também ativar a execução?") em vez de encadear
  silenciosamente.** Descartada por decisão do usuário: para
  `maintainer`/`owner`, os dois cliques de hoje JÁ são consentimento
  explícito e redundante — a segunda confirmação não protege uma decisão
  que a pessoa já tomou duas vezes (aceitar o handoff, depois clicar
  ativar). Perguntar de novo seria fricção sem ganho de segurança.
- **Baixar a exigência de `POST .../execution/activate` para `developer`,
  eliminando a distinção pela raiz.** Descartada — é exatamente o que
  RN-137 já tinha decidido NÃO fazer, porque inverteria em silêncio a
  resolução de papel EFETIVO das PRs que os dev agents abrem (toda PR
  passaria de `auto_approve` para `require_approval` sempre que quem
  ativasse fosse `developer`, sem ninguém ter decidido isso
  explicitamente). Esta fusão não reabre essa pergunta — ela só evita um
  clique redundante para quem já tinha os dois papéis.
- **Resolver o papel efetivo de PROJETO (não de workspace) para decidir a
  fusão.** Descartada por não existir hoje: o cliente não tem uma rota que
  devolva o papel efetivo por PROJETO (o mais próximo é o escopo
  `agent`/`area` do ADR 0064, que é sobre modelo de LLM, não sobre RBAC).
  Introduzir essa rota só para esta decisão de UX seria a causa errada —
  `useCurrentWorkspaceWithRole()` já é a aproximação usada em todo lugar
  equivalente da mesma tela.

## Consequências

- **`developer` não ganha o atalho — e isso é intencional, não uma lacuna.**
  Continua precisando de um `maintainer`/`owner` para ativar a execução
  depois, exatamente como hoje. Ninguém perde capacidade: quem só aceitava
  o handoff continua aceitando.
- **Zero mudança de contrato no backend.** `ExecutionController#activate`
  continua com `RequireRole('maintainer')` sem alteração; esta é uma decisão
  inteiramente de `apps/web`.
- **Um clique a menos é uma sessão de execução a mais rápido para chegar em
  `originSessionId` correto.** RN-135 (a sessão de chat fecha quando a
  execução decola por este caminho) passa a acontecer, para
  `maintainer`/`owner`, no mesmo instante do aceite — sem a janela entre os
  dois cliques em que a sessão de origem ficava `active` esperando o
  segundo.
- **O botão "Ativar execução" não foi removido do card.** Ele seria
  redundante para quem tem o papel (a fusão já fez o trabalho) e sem efeito
  para quem não tem (seguiria 403), mas removê-lo condicionalmente por
  papel abriria uma superfície de estado a mais para testar sem benefício
  claro — o card inteiro já some assim que o handoff deixa de estar
  `offered` (aceito), então a janela em que o botão "sobra" visível e
  inerte é, na prática, o tempo entre o clique e a invalidação da query de
  handoffs — não uma pendência funcional.
