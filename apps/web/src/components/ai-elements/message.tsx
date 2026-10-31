import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/shadcn/avatar';
import { Bubble, BubbleContent } from '@/components/shadcn/bubble';
import {
  Message as MessageBase,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from '@/components/shadcn/message';

type Props = {
  /** `end` = fala do usuário; `start` = do agente. */
  align?: 'start' | 'end';
  autor?: string;
  /** Iniciais ou ícone do avatar; omitido = sem avatar. */
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
}: Props) {
  return (
    <MessageBase align={align}>
      {avatar != null && (
        <Avatar>
          <AvatarFallback>{avatar}</AvatarFallback>
        </Avatar>
      )}
      <MessageContent>
        {autor && <MessageHeader>{autor}</MessageHeader>}
        <Bubble align={align} variant={variant}>
          <BubbleContent>{children}</BubbleContent>
        </Bubble>
        {rodape && <MessageFooter>{rodape}</MessageFooter>}
      </MessageContent>
    </MessageBase>
  );
}
