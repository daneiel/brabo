import type * as React from 'react';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/shadcn/avatar';
import { Bubble, BubbleContent } from '@/components/shadcn/bubble';
import {
  Message as MessageBase,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from '@/components/shadcn/message';

type Props = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** `end` = fala do usuário; `start` = do agente. */
  align?: 'start' | 'end';
  /** Texto ou nó (nome + modelo + meta). */
  autor?: ReactNode;
  /** Texto vira iniciais no `AvatarFallback`; um nó (já é avatar) entra cru. */
  avatar?: ReactNode;
  rodape?: ReactNode;
  variant?: 'default' | 'secondary' | 'muted' | 'tinted' | 'outline' | 'ghost' | 'destructive';
  children: ReactNode;
};

/** Padrão Message do shadcn (AT-647): só apresentação, texto por prop. */
export function MensagemDeConversa({
  align = 'start',
  autor,
  avatar,
  rodape,
  variant = 'muted',
  children,
  ...props
}: Props) {
  return (
    <MessageBase align={align} {...props}>
      {avatar != null &&
        (typeof avatar === 'string' ? (
          <Avatar>
            <AvatarFallback>{avatar}</AvatarFallback>
          </Avatar>
        ) : (
          avatar
        ))}
      <MessageContent>
        {autor && <MessageHeader>{autor}</MessageHeader>}
        {children && (
          <Bubble align={align} variant={variant}>
            <BubbleContent>{children}</BubbleContent>
          </Bubble>
        )}
        {rodape && <MessageFooter>{rodape}</MessageFooter>}
      </MessageContent>
    </MessageBase>
  );
}
