---
id: aceite-providers
title: O aceite dos providers de LLM com credencial real
sidebar_label: Aceite dos providers
sidebar_position: 6
description: O documento vivo que rastreia quais smokes de provider já rodaram contra chave de verdade, quanto custaram, e o que cada um prova que o mock não prova.
keywords: [providers, LLM, smoke, aceite, Fase 11, ADR 0043, credencial]
---

# O aceite dos providers de LLM com credencial real

O [ADR 0043](../adr/0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md)
entregou nove providers com a suite de contrato verde — **contra mock**. Ele
mesmo registrou, em "o que fica para depois", que o aceite com credencial real
dos seis smokes continuava aberto. Este arquivo é onde esse "depois" é
rastreado: uma linha por provider, atualizada **toda vez que uma chave
aparece**. O ADR não é editado; ele é o registro da decisão, este é o registro
da prova.

A regra de ouro da casa vale aqui inteira: capability só é declarada quando
provada. Enquanto um smoke não rodou contra chave real, o que existe sobre
aquele provider é leitura de documentação oficial — boa, verificada linha a
linha na Fase 11, e ainda assim não é execução.

## Estado em 2026-08-03

Varredura do ambiente nesta data: **nenhuma** das seis variáveis está
exportada, e não há chave de provider sob outro nome no `.env`. Sem a variável,
o `describe.skipIf(!apiKey)` pula a suite inteira com um aviso — que é o
comportamento correto, não uma falha. Nenhuma chamada paga foi feita; o custo
desta rodada é **US$ 0,00**.

| provider | smoke | variável | modelo default | rodado? | motivo | custo real (`token_usage`) |
|---|---|---|---|---|---|---|
| OpenRouter | `openrouter-provider.smoke.spec.ts` | `OPENROUTER_TEST_KEY` | `openai/gpt-4o-mini` | ❌ pulado | chave ausente no ambiente | — |
| Together AI | `together-provider.smoke.spec.ts` | `TOGETHER_TEST_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | ❌ pulado | chave ausente no ambiente | — |
| DeepInfra | `deepinfra-provider.smoke.spec.ts` | `DEEPINFRA_TEST_KEY` | `deepseek-ai/DeepSeek-V3` | ❌ pulado | chave ausente no ambiente | — |
| NVIDIA NIM | `nvidia-nim-provider.smoke.spec.ts` | `NVIDIA_NIM_TEST_KEY` | `meta/llama-3.2-3b-instruct` | ❌ pulado | chave ausente no ambiente | — |
| Bitdeer | `bitdeer-provider.smoke.spec.ts` | `BITDEER_TEST_KEY` | `moonshotai/Kimi-K2.5` | ❌ pulado | chave ausente no ambiente | — |
| Vultr | `vultr-provider.smoke.spec.ts` | `VULTR_TEST_KEY` | `kimi-k2-instruct` | ❌ pulado | chave ausente no ambiente | — |

Os arquivos vivem em `apps/api/test/infrastructure/llm/`. O modelo default é
sobrescrevível por `<PROVIDER>_TEST_MODEL` — útil quando a conta não tem acesso
ao modelo da coluna.

## Quanto custa fechar cada linha

Barato de propósito. Cada smoke faz **exatamente um turno de chat**, com o
prompt `Responda só a palavra "ok", sem mais nada.` — ordem de 20 tokens de
entrada e um punhado de saída. Tudo o mais no roteiro é gratuito: a verificação
da credencial é um `GET /v1/models` (ou `GET /key`) status-only, e o sync de
catálogo (nos três que têm `listModels: true`) é leitura.

| | chamadas pagas | chamadas gratuitas | ordem de grandeza |
|---|---|---|---|
| por smoke | 1 turno de chat (~20 tokens in) | teste de conexão + sync | **< US$ 0,001** |
| os seis juntos | 6 turnos de chat | — | **< US$ 0,01** |

Mesmo no modelo mais caro da tabela isso não chega a um centavo de dólar por
execução. O que custa não é o token: é ter a chave.

## O que cada smoke prova — e não é o mesmo para todos

A divisão segue a capability, exatamente como o ADR 0041 desenhou:

**Com `listModels: true` — OpenRouter, Together, DeepInfra.** O sync bate na
API de verdade e popula o catálogo. É aqui que o **preço real** encontra o
parser. O caso mais importante é a Together: o ADR 0043 registra que a unidade
do preço (USD por milhão de tokens vs. por token) foi **inferida** por
comparação com preço de mercado, porque a documentação oficial não declara — e
o smoke tem uma faixa de sanidade justamente para isso
(`inputPricePerMillionMicros` entre 10.000 e 1.000.000.000; fora dela, o
diagnóstico é "unidade errada", não "modelo caro"). Se algum dia der errado, é
achado a corrigir no parser e aqui, nunca a silenciar. O smoke também confirma
o RN-043: o modelo descoberto entra **desativado**, e a ativação é curadoria
manual.

**Com `listModels: false` — NVIDIA NIM, Bitdeer, Vultr.** Nenhum dos três
publica preço por token em documentação acessível (a NIM sequer cobra por
token: a unidade comercial é GPU/hora). O sync, portanto, **tem de pular** com
`pulado: 'sem_capability'` — e o smoke afirma exatamente isso, o que torna a
capability declarada verificável em vez de confiada. O modelo entra por seed /
curadoria manual com `manual_pricing = true`, e o que o smoke valida de fato é
o **id do modelo** contra a API real — hoje estimativa lida da doc — e o
caminho de metering ponta a ponta com o preço congelado.

Nos seis, o passo **1b** verifica a chave real contra a API real por
`TestStoredCredentialUseCase` — `ok` em cinco, e `nao_suportado` na DeepInfra,
que é o único sem endpoint de teste declarado. Antes do
[ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md) essa
prova acontecia embutida no cadastro; ela não sumiu, mudou de lugar e ficou
explícita.

Nos seis, o passo final é o mesmo e é o que interessa ao produto: uma sessão de
chat completa, sem evento `error` nem `metering_failed`, com uma linha em
`token_usage` carregando o preço **congelado** no momento do uso
([RN-044](../business-rules.md#rn-044)) — não o preço de hoje da tabela
`models`.

## Como fechar uma pendência

```bash
export OPENROUTER_TEST_KEY=...          # a variável do provider em questão
# opcional, se a conta não tiver o modelo default:
# export OPENROUTER_TEST_MODEL=...

pnpm --filter api test -- openrouter-provider.smoke.spec.ts
```

Requisitos:

- o banco de teste de pé — `TEST_DATABASE_URL`, default
  `postgres://brabo:brabo@localhost:5432/brabo_test` (o mesmo de qualquer
  teste de integração da api; o smoke chama `truncateAll` antes de começar);
- crédito na conta do provider. Desde o
  [ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md) o
  cadastro não testa nada — quem verifica a chave é o passo 1b do smoke
  (`TestStoredCredentialUseCase`, status-only), e uma chave válida sem saldo só
  falha mesmo no turno de chat.

Depois de rodar, **atualize a linha da tabela** acima com a data, o veredito e
o custo real. O custo sai do banco, não da estimativa:

```sql
SELECT provider, model_name, input_tokens, output_tokens, cost_micros
FROM token_usage ORDER BY created_at DESC LIMIT 1;
```

Se o smoke reprovar, a linha vira `❌ reprovado` com o motivo, e o achado vira
correção no provider — nunca uma capability declarada na base da confiança.

## Por que isto é um documento vivo

A tabela não é um relatório de uma data: é o estado corrente do aceite. Cada
chave que aparecer fecha uma linha e as outras seguem abertas, visíveis. O
modo de falha que este arquivo existe para evitar é o da Fase 10, descrito na
[colheita do primeiro dogfooding](./primeiro-dogfooding.md): a tabela de
observação que ninguém preencheu e virou `não medido` para sempre. Aqui, o
número vem de `token_usage` por consulta, e o que não rodou está escrito como
não rodou.
