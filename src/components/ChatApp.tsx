import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { errorMessage, GreenApi, pollNotifications, type Credentials } from '../api';
import {
  applyNotification,
  finishSending,
  readState,
  saveState,
  type ChatState,
  type MessageStatus,
} from '../model';
import { Alert, Avatar, Brand } from './ui';
import NewChat from './NewChat';

const time = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const day = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
const statuses: Record<MessageStatus, string> = {
  sending: 'Отправляется',
  queued: 'Принято сервером. Доставка ещё не подтверждена',
  sent: 'Отправлено',
  delivered: 'Доставлено',
  read: 'Прочитано',
  failed: 'Не отправлено',
  unknown: 'Доставка неизвестна — проверьте Telegram перед повтором',
};

export default function ChatApp({
  credentials,
  onLogout,
}: {
  credentials: Credentials;
  onLogout: () => void;
}) {
  const [api] = useState(() => new GreenApi(credentials));
  const storageKey = `green-telegram:${credentials.apiUrl}:${credentials.idInstance}`;
  const [state, setState] = useState(() => readState(storageKey));
  const stateRef = useRef(state);
  const [search, setSearch] = useState('');
  const [newChat, setNewChat] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const sendLock = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const active = state.chats.find((chat) => chat.id === state.activeId);
  const draft = active ? drafts[active.id] || '' : '';

  function commit(update: (current: ChatState) => ChatState) {
    const next = update(stateRef.current);
    saveState(storageKey, next);
    stateRef.current = next;
    setState(next);
  }
  function safeCommit(update: (current: ChatState) => ChatState) {
    try {
      commit(update);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void pollNotifications(
      api,
      controller.signal,
      (body) => {
        if (body.typeWebhook === 'stateInstanceChanged')
          setInstanceError(
            body.stateInstance === 'authorized'
              ? null
              : 'Telegram-инстанс отключён. Авторизуйте его в личном кабинете GREEN-API.',
          );
        commit((current) => applyNotification(current, body));
      },
      setPollError,
    );
    return () => {
      controller.abort();
      requestController.current?.abort();
    };
    // The client and storage key are fixed for the lifetime of this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const connectionError = instanceError || pollError;
  useEffect(() => {
    if (scrollArea.current && nearBottom.current)
      scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [active?.id, active?.messages.length]);
  useEffect(() => {
    if (composer.current) {
      composer.current.style.height = '24px';
      const style = getComputedStyle(composer.current);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      composer.current.style.height = `${Math.min(composer.current.scrollHeight - padding, 144)}px`;
    }
  }, [draft]);

  function select(id: string | null) {
    nearBottom.current = true;
    setActionError('');
    safeCommit((current) => ({
      ...current,
      activeId: id,
      chats: current.chats.map((chat) => (chat.id === id ? { ...chat, unread: 0 } : chat)),
    }));
  }
  async function send() {
    if (!active || !draft.trim() || draft.length > 4096 || sendLock.current) return;
    const chatId = active.id;
    const text = draft.trim();
    const localId = crypto.randomUUID();
    sendLock.current = true;
    setSending(true);
    setActionError('');
    const controller = new AbortController();
    requestController.current = controller;
    try {
      commit((current) => ({
        ...current,
        chats: current.chats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [
                  ...chat.messages,
                  { id: localId, text, timestamp: Date.now(), outgoing: true, status: 'sending' },
                ],
              }
            : chat,
        ),
      }));
      setDrafts((current) => ({ ...current, [chatId]: '' }));
      nearBottom.current = true;
      const id = await api.send(chatId, text, controller.signal);
      if (!controller.signal.aborted)
        commit((current) => finishSending(current, chatId, localId, id));
    } catch (error) {
      if (controller.signal.aborted) return;
      // A network failure may happen after the server accepts a message. Never
      // resend automatically: a retry could deliver the same text twice.
      safeCommit((current) => ({
        ...current,
        chats: current.chats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: chat.messages.map((message) =>
                  message.id === localId ? { ...message, status: 'unknown' } : message,
                ),
              }
            : chat,
        ),
      }));
      setActionError(
        `${errorMessage(error)} Перед повторной отправкой проверьте доставку в Telegram.`,
      );
    } finally {
      sendLock.current = false;
      setSending(false);
      composer.current?.focus();
    }
  }
  const filtered = state.chats.filter((chat) =>
    `${chat.name} ${chat.phone || ''}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <main className={`messenger ${active ? 'has-active-chat' : ''}`}>
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="wordmark">
            <Brand small />
            <strong>Telegram</strong>
          </div>
          <button
            className="icon-button"
            aria-label="Выйти"
            title="Выйти"
            onClick={() => {
              requestController.current?.abort();
              sessionStorage.removeItem(storageKey);
              onLogout();
            }}
          >
            <LogOut size={21} />
          </button>
        </header>
        <div className="search">
          <Search size={19} />
          <input
            aria-label="Поиск чатов"
            placeholder="Поиск"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="list-heading">
          <span>
            Сообщения <span className="count">{state.chats.length}</span>
          </span>
          <button className="new-chat-button" onClick={() => setNewChat(true)}>
            <Plus size={17} /> Новый чат
          </button>
        </div>
        <nav className="chat-list" aria-label="Чаты">
          {filtered.map((chat) => {
            const last = chat.messages.at(-1);
            return (
              <button
                key={chat.id}
                className={`chat-row ${chat.id === active?.id ? 'selected' : ''}`}
                onClick={() => select(chat.id)}
              >
                <Avatar chat={chat} />
                <div className="chat-row-content">
                  <div className="chat-row-title">
                    <strong>{chat.name}</strong>
                    {last && <time>{time(last.timestamp)}</time>}
                  </div>
                  <div className="chat-row-preview">
                    <span>
                      {last
                        ? `${last.outgoing ? 'Вы: ' : ''}${last.text}`
                        : 'Напишите первое сообщение'}
                    </span>
                    {chat.unread > 0 && <b className="unread">{chat.unread}</b>}
                  </div>
                </div>
              </button>
            );
          })}
          {!filtered.length && (
            <div className="empty-list">
              <MessageCircle size={34} strokeWidth={1.3} />
              <h3>{search ? 'Ничего не найдено' : 'Здесь будут ваши чаты'}</h3>
              <p>
                {search
                  ? 'Попробуйте другое имя или номер.'
                  : 'Создайте чат по номеру телефона и начните разговор.'}
              </p>
              {!search && (
                <button className="text-button" onClick={() => setNewChat(true)}>
                  Начать общение <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}
        </nav>
        <footer className="sidebar-footer">
          <span className={`connection-dot ${connectionError ? 'warning' : ''}`} />
          <div>
            <strong>{connectionError ? 'Проблема подключения' : 'Инстанс подключён'}</strong>
            <span>GREEN-API · {credentials.idInstance}</span>
          </div>
          <ShieldCheck size={19} />
        </footer>
      </aside>
      <section className="conversation" aria-label="Переписка">
        {active ? (
          <>
            <header className="conversation-header">
              <button
                className="icon-button back-button"
                aria-label="Назад к чатам"
                onClick={() => select(null)}
              >
                <ArrowLeft />
              </button>
              <Avatar chat={active} />
              <div>
                <h1>{active.name}</h1>
                <p>{active.phone ? `+${active.phone} · Telegram` : 'Telegram'}</p>
              </div>
              <span className="text-only">
                <MessageCircle size={16} /> Текстовые сообщения
              </span>
            </header>
            {connectionError && (
              <div className="poll-error">
                <Alert>
                  {connectionError} Получение будет возобновлено после восстановления соединения;
                  при ошибке доступа войдите заново.
                </Alert>
              </div>
            )}
            <div
              className="message-area"
              ref={scrollArea}
              role="log"
              aria-label="Сообщения"
              aria-live="polite"
              onScroll={(event) => {
                const element = event.currentTarget;
                nearBottom.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 100;
              }}
            >
              <div className="message-column">
                {!active.messages.length && (
                  <div className="conversation-start">
                    <span>👋</span>
                    <h2>Начните с «Привет!»</h2>
                    <p>
                      Здесь появятся ваши сообщения
                      <br />и ответы собеседника.
                    </p>
                  </div>
                )}
                {active.messages.map((message, index) => (
                  <div key={message.id} className="message-group">
                    {(index === 0 ||
                      day(active.messages[index - 1].timestamp) !== day(message.timestamp)) && (
                      <div className="date-separator">
                        <span>{day(message.timestamp)}</span>
                      </div>
                    )}
                    <div className={`message ${message.outgoing ? 'outgoing' : 'incoming'}`}>
                      <div className="message-text">{message.text}</div>
                      <div className="message-meta">
                        <time>{time(message.timestamp)}</time>
                        {message.outgoing && (
                          <span
                            title={statuses[message.status]}
                            aria-label={statuses[message.status]}
                            className={`message-status ${message.status}`}
                          >
                            {['unknown', 'failed'].includes(message.status) ? (
                              <CircleAlert size={15} />
                            ) : message.status === 'sending' ? (
                              <Clock3 size={14} />
                            ) : message.status === 'read' || message.status === 'delivered' ? (
                              <CheckCheck size={17} />
                            ) : (
                              <Check size={16} />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    {['unknown', 'failed'].includes(message.status) && (
                      <div className="failed-note">{statuses[message.status]}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="composer-area">
              {actionError && <Alert>{actionError}</Alert>}
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <textarea
                  ref={composer}
                  aria-label="Сообщение"
                  placeholder="Сообщение"
                  value={draft}
                  rows={1}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [active.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  className="send-button"
                  aria-label="Отправить сообщение"
                  disabled={!draft.trim() || draft.length > 4096 || sending}
                >
                  <Send size={23} fill="currentColor" strokeWidth={1.4} />
                </button>
              </form>
              <div className={`composer-hint ${draft.length > 4096 ? 'over-limit' : ''}`}>
                <span>Enter — отправить · Shift + Enter — новая строка</span>
                <span>{draft.length} / 4096</span>
              </div>
            </div>
          </>
        ) : (
          <>
            {connectionError && (
              <div className="poll-error">
                <Alert>{connectionError}</Alert>
              </div>
            )}
            <div className="welcome-chat">
              <div className="welcome-icon">
                <Send size={48} fill="currentColor" strokeWidth={1} />
              </div>
              <h1>
                Хороший разговор
                <br />
                начинается с сообщения
              </h1>
              <p>
                Выберите чат слева или создайте новый,
                <br />
                чтобы написать собеседнику в Telegram.
              </p>
              <button className="primary" onClick={() => setNewChat(true)}>
                <Plus size={19} /> Новый чат
              </button>
              <span className="welcome-caption">Ваши сообщения. Ваши разговоры.</span>
            </div>
          </>
        )}
      </section>
      {newChat && (
        <NewChat
          api={api}
          onClose={() => setNewChat(false)}
          onCreate={(chat) => {
            commit((current) => ({
              ...current,
              activeId: chat.id,
              chats: current.chats.some((item) => item.id === chat.id)
                ? current.chats.map((item) => (item.id === chat.id ? { ...item, unread: 0 } : item))
                : [chat, ...current.chats],
            }));
            nearBottom.current = true;
            setNewChat(false);
          }}
        />
      )}
    </main>
  );
}
