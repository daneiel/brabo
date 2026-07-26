---
category: Primitivas
keywords: [modal, diálogo, overlay, confirmação]
---

# Modal

Diálogo sobre um backdrop que cobre a viewport. **Não tem prop de aberto ou
fechado**: quem usa monta o Modal quando quer mostrá-lo e desmonta ao fechar.

## Como usar

```tsx
{confirmando && (
  <Modal title="Encerrar a sessão?" onClose={() => setConfirmando(false)}>
    <p>A sessão passa para <b>closing</b> e os agentes param de aceitar trabalho novo.</p>
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <Button variant="ghost" onClick={() => setConfirmando(false)}>Cancelar</Button>
      <Button variant="danger" onClick={encerrar}>Encerrar</Button>
    </div>
  </Modal>
)}
```

## O que respeitar

- `onClose` é obrigatório e é o que o X do cabeçalho chama. Sem ele o usuário
  fica preso.
- O Modal não monta rodapé: as ações são children, e a convenção do produto é
  alinhá-las à direita, com a destrutiva por último.
- `title` aceita ReactNode — dá para compor com `<code>` ou um Badge.
