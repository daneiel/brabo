---
category: Primitivas
keywords: [toast, notificação, feedback, provider, contexto]
---

# ToastProvider

Provider da pilha de toasts. **Não recebe os toasts por prop** — quem está
dentro da árvore chama `useToast().showToast()`.

## Como usar

```tsx
// Uma vez, no topo da árvore.
<ToastProvider>
  <App />
</ToastProvider>

// Em qualquer lugar dentro dela.
const { showToast } = useToast();
showToast({
  title: 'Ação aprovada',
  message: 'dev-backend já está executando o comando.',
  tone: 'success',
});
```

## O que respeitar

- `useToast()` **lança** fora do provider. Se um componente pode ser montado
  isolado, garanta o provider acima dele.
- `durationMs` default é 5000, e o toast se remove sozinho. Em preview ou
  screenshot, passe um valor grande — senão o resultado depende de quando a
  captura aconteceu.
- Tons: `success` deu certo · `warning` atenção · `danger` falhou ou terminou
  mal · `accent` informação relevante.
- `message` é opcional; sem ela o toast encolhe para uma linha.
