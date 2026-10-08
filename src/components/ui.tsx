import { Send, CircleAlert } from 'lucide-react';
import type { Chat } from '../model';

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'small' : ''}`}>
      <Send fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
    </div>
  );
}
export function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div className="alert" role="alert">
      <CircleAlert size={18} />
      <span>{children}</span>
    </div>
  );
}
export function Avatar({ chat }: { chat: Chat }) {
  return (
    <div
      className={`avatar color-${Number(chat.id.replace(/\D/g, '').slice(-1)) % 4 || 0}`}
      aria-hidden="true"
    >
      {chat.name.startsWith('+')
        ? chat.phone?.slice(-2) || chat.name.slice(-2)
        : chat.name.replace('@', '').slice(0, 2).toUpperCase()}
    </div>
  );
}
