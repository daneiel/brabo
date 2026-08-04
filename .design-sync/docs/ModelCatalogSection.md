---
category: Dominio
keywords: [catálogo, modelos, curadoria, sync, provider, workspace]
---

# ModelCatalogSection

A tela de curadoria do catálogo de modelos de um workspace: sincroniza com os
providers, lista o que foi descoberto e liga/desliga em lote o que aparece no
seletor.

## Card de preview

Este componente mostra o **floor card**, de propósito. Ele busca dados
(`useQuery`/`useMutation`) e precisa de um `QueryClientProvider` acima; pôr esse
provider no `cfg.provider` global do design-sync envolveria os 57 componentes e
limparia todas as grades, o que é caro demais para um componente. Quem quiser
vê-lo funcionando abre a aba **Configurações** de um projeto na app.

## Como usar

```tsx
// Pende do WORKSPACE porque a curadoria é por workspace (ADR 0049).
<ModelCatalogSection workspaceId={project.workspaceId} />
```

## O que respeitar

- **O catálogo é global; a curadoria é do workspace.** Nome, preço e
  capabilities são fato do provider e valem para a instalação inteira; o que
  pende do workspace é a decisão "isto aparece no seletor?".
- **O que o sync descobre entra DESATIVADO** ([RN-043]). Um catálogo de
  provider tem centenas de linhas — despejá-las ativas tornaria a escolha
  impossível e ligaria modelo caro sem ninguém decidir.
- **Modelo que sumiu do provider é marcado, nunca some da lista.**
  `token_usage` e `model_bindings` apontam para ele; escondê-lo deixaria o
  binding afetado sem explicação.
