# ADR 0102 — Revisão do ADR 0065: a fronteira de efeito externo deixa de ser `deny` e vira teto absoluto

- **Status:** Aceito
- **Data:** 2026-08-20
- **Contexto:** decisão GLOBAL do dono do produto sobre a política de
  git/sudo, RN-418 (revisa RN-106)
- **Revisa:** [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

## Contexto

O [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) decidiu, à época, que
`git push`, abertura de PR e deploy nunca saem pelo terminal — a regra
era `deny` incondicional, aplicada ANTES de qualquer estágio permissivo
em `decide()`, com a mensagem redirecionando pra ação TIPADA
(`git_push`/`git_merge`/`pr_open`). A razão declarada do `deny` (em vez
de `require_approval`) era concreta: existia "sempre permitir", e um
clique gravaria o padrão em `allow` no `permissions.json`, abrindo a
porta pra sempre — negar de saída era a única forma de garantir que a
porta nunca abrisse.

O dono do produto pediu, de forma EXPLÍCITA e GLOBAL, uma mudança de
semântica: `sudo`/`doas` e comando de terminal com efeito externo git
devem SEMPRE pedir autorização humana — nunca auto-aprováveis, mesmo com
"modo automático" ligado — e qualquer OUTRO comando deve auto-aprovar
quando o modo automático estiver ligado. Isso é diferente de `deny`: é
"sempre vira `proposed_action` pendente, decidida caso a caso", não
"sempre recusado sem virar nada".

Um sistema automático de segurança sinalizou esta mudança durante a
implementação (a alteração de uma regra que o próprio CLAUDE.md descrevia
como `deny` absoluto merece escrutínio redobrado) — o dono do produto
confirmou explicitamente, depois de revisar a mudança, que a decisão era
essa mesmo.

## Decisão

`git push`/abertura de PR/deploy (RN-106, revisada) e `sudo`/`doas`
(novo) saem do bloco de fronteira (que ficava logo após o IAM,
retornando `deny`) e viram TETO ABSOLUTO — no MESMO bloco final onde já
vivem os outros tetos (merge protegida, `instruction_patch`,
`parallelize`/`raise_max_parallel`, escopo de caminho), no MESMO padrão
de código (`current.policy === 'auto_approve'` → sobrescreve pra
`require_approval`). Por construção, o teto vale mesmo que
`agent_autonomy` diga `auto_approve` pro curinga `"*"`, e mesmo que
`permissions.json` tenha uma entrada `allow` que casaria.

**A fresta do "sempre permitir" foi fechada NA FONTE**, condição
necessária pra este ADR ser seguro: `ApproveAlwaysActionUseCase`/
`patternForAction` RECUSAM gravar padrão em `allow` pra ação de terminal
com efeito externo git ou comando privilegiado. O usuário ainda pode
aprovar a INSTÂNCIA específica pelo fluxo normal de aprovação — só o
"sempre permitir" (que gravaria pra sempre) é recusado, com mensagem
clara explicando por quê. Sem essa segunda metade, o teto absoluto vira
decorativo — um clique bastaria pra reabrir a porta que ele diz fechar.
É exatamente o argumento original do ADR 0065 pro `deny`, só que resolvido
na origem em vez de bloqueando o sintoma.

`sudo`/`doas` ganham categoria própria em `external-effect.ts`
(`comandoPrivilegiadoNoComando`), casando por VERBO em qualquer segmento
do comando (mesmo princípio de `efeitoExternoNoComando` pra git). Não têm
ação tipada equivalente pra redirecionar — a mensagem só explica por que
aquele comando pede decisão humana.

## Consequências

- `require_approval` aqui não é "mais fraco" que `deny` no sentido de
  "o agente consegue fazer sozinho" — em NENHUM dos dois estados o
  comando executa sem uma decisão humana explícita. A diferença é
  puramente de MECANISMO: antes, o caminho de terminal para git era
  bloqueado e só a ação tipada (que já sempre exigia aprovação) existia;
  agora, o próprio caminho de terminal também pode virar `proposed_action`
  pendente, auditável no event log, decidida caso a caso — coerente com o
  resto do produto, que prefere ação pendente e rastreável a recusa muda.
- Esta é a QUARTA/QUINTA linha da régua de tetos absolutos que `decide()`
  aplica incondicionalmente — CLAUDE.md e a documentação de convenções
  precisam contar este teto junto dos demais a partir de agora.
- O motor do runner local (ADR 0103) é o consumidor mais direto desta
  mudança: sem ela, um `sudo` legítimo na máquina do usuário cairia no
  `require_approval` genérico (sem garantia de nunca virar auto-aprovável
  se `permissions.json`/auto mode um dia cobrissem esse verbo por
  descuido) — o teto absoluto fecha esse risco por construção, não por
  convenção.
