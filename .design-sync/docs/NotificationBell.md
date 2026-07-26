---
category: Dominio
keywords: [notificações, sino, pendências, agrupado, topbar]
---

# NotificationBell

O sino da topbar. Agrupa eventos não lidos **por projeto** e abre um painel com
as linhas de evento (cada uma é um `EventItem`).

## Como usar

```tsx
<NotificationBell
  groups={[{ projectId: 'p1', projectName: 'plataforma-de-pagamentos', events }]}
  unreadCount={3}
  onMarkRead={marcarTodasLidas}
/>
```

## O que respeitar

- **O painel é estado interno**, sem prop que o abra. Montar o componente
  mostra só o sino: num preview ou teste que precise do painel, é preciso
  clicar no botão `aria-label="Notificações"`.
- `unreadCount` é independente de `groups` — vem do contador do servidor e é o
  que decide se o badge aparece (acima de 99 vira "99+").
- `onMarkRead` marca **tudo** como lido, não um grupo. Não existe marcação por
  projeto neste componente.
