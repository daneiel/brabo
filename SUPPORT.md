# Onde pedir ajuda

Cada tipo de assunto tem um caminho. Usar o certo faz você ser respondido mais
rápido.

| você tem | vá para |
|---|---|
| **dúvida de uso** — "como faço X?", "isso é esperado?" | [issue com o template de dúvida](https://github.com/daneiel/brabo/issues/new/choose) |
| **bug reprodutível** — passos claros, comportamento errado | [issue de bug](https://github.com/daneiel/brabo/issues/new/choose) |
| **ideia ou pedido de funcionalidade** | [issue de funcionalidade](https://github.com/daneiel/brabo/issues/new/choose) |
| **erro ou lacuna na documentação** | [issue de documentação](https://github.com/daneiel/brabo/issues/new/choose) |
| **falha de segurança** | [SECURITY.md](SECURITY.md) — **nunca** issue pública |
| **quer contribuir com código** | [CONTRIBUTING.md](CONTRIBUTING.md) |

> **TODO(humano):** o GitHub Discussions está **desabilitado** neste
> repositório. Dúvida de uso é o caso que mais se beneficia dele — não vira
> issue, não tem "resolvido", e a resposta serve para a próxima pessoa. Se
> quiser habilitar (*Settings → Features → Discussions*), troque a primeira
> linha da tabela por um link para Discussions e ajuste
> `.github/ISSUE_TEMPLATE/config.yml`, que já tem o link comentado.

## Antes de abrir

Três coisas que resolvem boa parte dos casos:

1. **Procure nas issues existentes**, inclusive nas fechadas.
2. **Veja a documentação** — em especial
   [Primeiros passos](docs/getting-started.md) para problemas de setup e o
   [Runbook](docs/runbook.md) para operação. Os dois têm tabela de sintoma →
   causa.
3. **Agente com comportamento estranho** (resposta vazia, truncada, lentíssima)
   quase nunca é bug de código: é
   [ambiente de inferência](docs/runbook.md#ambiente-de-inferencia). Confira
   essa seção antes de relatar.

## O que ajuda no relato

Versão (`BRABO_VERSION` ou a tag), como está rodando (compose de dev, compose
de produção, Kubernetes), o que você esperava, o que aconteceu, e o log
relevante. Os templates de issue perguntam isso — preencher poupa uma rodada
inteira de "qual versão?".

## Prazo

Projeto mantido em tempo livre. Respondo em geral em até uma semana. Sem SLA,
sem suporte comercial.
