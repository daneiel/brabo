# Modelo de time e fluxo de entregáveis

> Contexto consolidado da sessão de desenho do modelo de time
> (ago/2026), auditado contra o estado real do produto. A especificação
> formal vive em [`docs/fluxo.yml`](../fluxo.yml); este documento
> explica as decisões. Decisão estrutural: ADR 0085. Peças irmãs:
> `docs/gates.yml` (ADR 0054) e `agent-areas.ts` (catálogo, FASE 18).

## Origem

O modelo traduz o mapa de profissões de um time de entrega de alta
performance (Arquiteto, Tech Lead, PO/PM, Staff, SRE/Platform,
DevOps/Infra, QA/SDET, AppSec, Data/Analytics Engineer, UX, Delivery,
DBA) para agentes do Brabo, sob dois critérios:

1. Só existe papel separado quando existe entregável distinto E gate
   distinto. Quebrar por organograma gera handoff sem ganho.
2. Toda transição entre papéis é um gate declarado, com verificação
   por script — nunca anotação manual (lição da Fase 10/13).

O princípio que emergiu da segregação: **quase toda separação é
primeiro de ENTREGÁVEL e MOMENTO, e só depois (talvez) de agente** —
QA e AppSec ganham o momento de design mantendo um agente só;
analytics nasceu como saída nova do medicao antes de ser papel. O papel
se materializa quando o artefato dele já circula, nunca antes — exceto
quando o dono do produto decide ANTECIPAR a construção sem esperar o
gatilho orgânico, como fez para `analytics`/`delivery-metricas`
(ADR 0089): os dois viraram `status: active` como SCRIPT de relatório
(`analise:funil`), nunca agente — a forma que o critério de separação
já prescrevia.

## Decisões do dono do produto

- **Engineering Manager: removido.** Não há gestão de pessoas entre
  agentes.
- **Criativo é a porta de entrada** — transforma conversa livre em
  necessidade de negócio. Absorve o discovery do UX.
- **Psicólogo e Anamnese: em-refinamento.** Código ativo, fora do
  fluxo formal até redefinição dos entregáveis. Pendências criadas:
  a proposta de subir `max_parallel` (RN-086) fica sem autor, e o
  gatilho de ativação do Staff fica órfão.
- **Delivery absorvido** pelo Harness (orquestração) + medição (DORA
  PARCIAL entregue como relatório — funil real, lead time real,
  deployment frequency real; MTTR e change failure rate seguem
  `status: lacuna`, dependentes de sinal de incidente real —
  ADR 0089); **DBA absorvido** por Dev Lead (migração) e Platform
  (tuning).

## Invariantes do fluxo

1. Nenhum artefato sem destinatário declarado.
2. Nenhum papel inicia sem entradas completas — falta gera devolução
   com motivo, nunca suposição silenciosa.
3. Toda transição é gate do registro declarativo (ADR 0054).
4. O loop de retorno é obrigatório: telemetria → Arquiteto e métricas
   de produto → PO são artefatos com destinatário.
5. Fronteira Arquiteto × Dev Lead: decisão que cabe num PR revertível
   é do Dev Lead; decisão irreversível é do Arquiteto.

## Tabela de gatilhos de ativação

| Gatilho no produto | Papéis que ele ativa/separa |
|---|---|
| Gate `implementavel` criado | `qa-estrategia` + `appsec` (segundo momento dos agentes existentes) |
| Antecipado por decisão do dono do produto (ADR 0089) | `analytics`/`delivery-metricas` viram `active` como script, antes do gatilho orgânico |
| Métricas de produto COMPLETAS viram entrada do PO | resto de `analytics` (o que ADR 0089 não fechou) |
| `DEPLOY_ENABLED` flipa | `platform` ativa → depois `secops-runtime` |
| Anamnese sai do refinamento | gatilho do `staff` volta a ter dono |
| Projeto gerenciado com UI própria | `ux-designer` separa do Criativo |
| Volume real de dados | `dbre` separa de Dev Lead/Platform |
| — (nunca) | `delivery-metricas` vira relatório, não agente (ADR 0089, já entregue) |

## Estado da malha (auditado)

**A descida está quase completa; a subida é o que falta.** Lacunas:

| Lacuna | Onde | Referência |
|---|---|---|
| Gate `necessidade-validada` não existe | Criativo → PO | gate novo = ADR |
| Plano de teste shift-left | QA → Dev Lead | proposto |
| Threat model no design | SecOps → Dev Lead/Infra | proposto |
| Delegação Dev Lead → dev | corte declarado | ADR 0053 item 5 |
| Gate `implementavel` | Dev Lead | proposto |
| Métricas de produto → PO | loop de negócio | Onda 3/H3 |
| `deployavel`/`operavel` | Infra/Platform | planned, DEPLOY_ENABLED |

## Propostas pendentes de decisão

- [ ] `metricas-de-produto` como entrada obrigatória do PO após o
      primeiro release.
- [ ] Anti-padrão do Criativo como validação real do gate
      `necessidade-validada`.
- [ ] Quem herda o gatilho do Staff e a proposta de teto enquanto a
      Anamnese estiver em refinamento — ou ambos aguardam, declarado.
