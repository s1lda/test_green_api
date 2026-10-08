import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, CircleAlert, Clock3, Eye, EyeOff, LogOut, MessageCircle, Plus, Search, Send, ShieldCheck, X } from 'lucide-react';
import { errorMessage, GreenApi, normalizePhone, pollNotifications, validateCredentials, type Credentials } from './api';
import { applyNotification, finishSending, readState, saveState, type Chat, type ChatState, type MessageStatus } from './model';

const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const day = (timestamp: number) => new Date(timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const statuses: Record<MessageStatus, string> = { sending: 'Отправляется', queued: 'В очереди отправки', sent: 'Отправлено', delivered: 'Доставлено', read: 'Прочитано', failed: 'Не отправлено', unknown: 'Доставка неизвестна — проверьте Telegram перед повтором' };

function Brand({ small = false }: { small?: boolean }) { return <div className={`brand ${small ? 'small' : ''}`}><Send fill="currentColor" strokeWidth={1.5} aria-hidden="true" /></div>; }
function Alert({ children }: { children: React.ReactNode }) { return <div className="alert" role="alert"><CircleAlert size={18} /><span>{children}</span></div>; }
function Avatar({ chat }: { chat: Chat }) { return <div className={`avatar color-${Number(chat.id.replace(/\D/g, '').slice(-1)) % 4 || 0}`} aria-hidden="true">{chat.name.startsWith('+') ? chat.phone?.slice(-2) || chat.name.slice(-2) : chat.name.replace('@', '').slice(0, 2).toUpperCase()}</div>; }

function Login({ onConnect }: { onConnect: (credentials: Credentials) => void }) {
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setError(''); setBusy(true);
    controller.current = new AbortController();
    try {
      const credentials = validateCredentials({ idInstance: String(form.get('idInstance')), apiTokenInstance: String(form.get('apiTokenInstance')), apiUrl: String(form.get('apiUrl') || '') });
      await new GreenApi(credentials).connect(controller.current.signal);
      if (!controller.current.signal.aborted) onConnect(credentials);
    } catch (err) { if (!controller.current?.signal.aborted) setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <header className="landing-header"><div className="wordmark"><Brand small /><span>Telegram <span className="wordmark-light">/ GREEN-API</span></span></div><a href="https://green-api.com/telegram/docs/" target="_blank" rel="noreferrer">Документация <ArrowRight size={15} /></a></header>
    <div className="login-layout">
      <section className="intro"><span className="eyebrow"><span /> ПРОСТО ОСТАВАЙТЕСЬ НА СВЯЗИ</span><h1>Ваш Telegram.<br />Ничего лишнего.</h1><p className="intro-copy">Простой чат для важных разговоров.<br />Отправляйте сообщения и получайте ответы<br className="desktop-break" /> в одном знакомом интерфейсе.</p>
        <div className="chat-preview" aria-hidden="true"><div className="preview-top"><div className="preview-avatar">А</div><div><strong>Александра</strong><span>Пример переписки</span></div><span className="preview-dot" /></div><div className="preview-messages"><div className="preview-date">Сегодня</div><div className="preview-bubble incoming">Привет! Как продвигается проект?<small>12:40</small></div><div className="preview-bubble outgoing">Привет! Всё готово, давай обсудим ✨<small>12:41 <CheckCheck size={14} /></small></div><div className="preview-bubble incoming short">Отлично, я на связи!<small>12:42</small></div></div><div className="preview-input">Сообщение <span><Send size={18} /></span></div></div>
        <div className="intro-note"><MessageCircle size={17} /> Только текст. Только общение.</div>
      </section>
      <section className="login-card"><Brand /><h2>Добро пожаловать</h2><p className="card-copy">Подключите свой Telegram-инстанс,<br />чтобы начать общение.</p>
        <form onSubmit={submit}><label htmlFor="idInstance">ID инстанса</label><input id="idInstance" name="idInstance" placeholder="Например, 4100123456" inputMode="numeric" autoComplete="off" required disabled={busy} /><p className="field-hint">idInstance из личного кабинета GREEN-API</p><label htmlFor="apiTokenInstance">API-токен</label><div className="password-field"><input id="apiTokenInstance" name="apiTokenInstance" type={showToken ? 'text' : 'password'} placeholder="Ваш apiTokenInstance" autoComplete="off" required disabled={busy} /><button type="button" className="icon-button" aria-label={showToken ? 'Скрыть токен' : 'Показать токен'} onClick={() => setShowToken(!showToken)}>{showToken ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>
          <details className="advanced"><summary>Настройки сервера <ChevronDown size={15} /></summary><label htmlFor="apiUrl">Адрес API</label><input id="apiUrl" name="apiUrl" type="url" placeholder="https://4100.api.green-api.com" disabled={busy} /><p className="field-hint">Оставьте пустым для определения по ID. Если адрес отличается, скопируйте apiUrl из кабинета.</p></details>
          {error && <Alert>{error}</Alert>}<button className="primary connect-button" disabled={busy}>{busy ? 'Подключаемся…' : 'Подключиться'}{!busy && <ArrowRight size={19} />}</button>
        </form><div className="privacy"><ShieldCheck size={17} /><span>Токен хранится только в памяти вкладки</span></div><div className="card-footer">Нет инстанса? <a href="https://console.green-api.com/" target="_blank" rel="noreferrer">Создать в GREEN-API <ArrowRight size={13} /></a></div>
      </section>
    </div><footer className="landing-footer"><span>Тестовое задание · React + GREEN-API</span><span>Сделано для простого общения</span></footer>
  </main>;
}

function NewChat({ api, onCreate, onClose }: { api: GreenApi; onCreate: (chat: Chat) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => controller.current?.abort(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    controller.current = new AbortController();
    try {
      const phone = normalizePhone(String(new FormData(event.currentTarget).get('phone')));
      const contact = await api.findContact(phone, controller.current.signal);
      if (!controller.current.signal.aborted) onCreate({ ...contact, messages: [], unread: 0 });
    } catch (err) { if (!controller.current?.signal.aborted) setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="dialog-heading"><div className="dialog-icon"><MessageCircle /></div><button className="icon-button" aria-label="Закрыть" onClick={onClose}><X /></button></div><h2>Новый чат</h2><p className="muted">Введите номер собеседника в Telegram.</p><form onSubmit={submit}><label htmlFor="phone">Номер телефона</label><input id="phone" name="phone" type="tel" placeholder="+7 999 123-45-67" required autoFocus disabled={busy} /><p className="field-hint">В международном формате, с кодом страны</p>{error && <Alert>{error}</Alert>}<button className="primary" disabled={busy}>{busy ? 'Ищем собеседника…' : 'Начать общение'}<ArrowRight size={18} /></button></form></dialog>;
}

function ChatApp({ credentials, onLogout }: { credentials: Credentials; onLogout: () => void }) {
  const [api] = useState(() => new GreenApi(credentials));
  const storageKey = `green-telegram:${credentials.apiUrl}:${credentials.idInstance}`;
  const [state, setState] = useState(() => readState(storageKey));
  const stateRef = useRef(state);
  const [search, setSearch] = useState('');
  const [newChat, setNewChat] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const sendLock = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const active = state.chats.find(chat => chat.id === state.activeId);
  const draft = active ? drafts[active.id] || '' : '';

  function commit(update: (current: ChatState) => ChatState) {
    const next = update(stateRef.current);
    saveState(storageKey, next);
    stateRef.current = next; setState(next);
  }
  function safeCommit(update: (current: ChatState) => ChatState) {
    try { commit(update); } catch (error) { setActionError(errorMessage(error)); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void pollNotifications(api, controller.signal, body => {
      if (body.typeWebhook === 'stateInstanceChanged' && body.stateInstance !== 'authorized') throw new Error('Telegram-инстанс отключён. Авторизуйте его в личном кабинете GREEN-API.');
      commit(current => applyNotification(current, body));
    }, setPollError);
    return () => { controller.abort(); requestController.current?.abort(); };
    // The client and storage key are fixed for the lifetime of this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  useEffect(() => {
    if (scrollArea.current && nearBottom.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [active?.id, active?.messages.length]);
  useEffect(() => {
    if (composer.current) { composer.current.style.height = '24px'; composer.current.style.height = `${Math.min(composer.current.scrollHeight, 144)}px`; }
  }, [draft]);

  function select(id: string | null) {
    nearBottom.current = true;
    safeCommit(current => ({ ...current, activeId: id, chats: current.chats.map(chat => chat.id === id ? { ...chat, unread: 0 } : chat) }));
    setActionError('');
  }
  async function send() {
    if (!active || !draft.trim() || draft.length > 4096 || sendLock.current) return;
    const chatId = active.id; const text = draft.trim(); const localId = crypto.randomUUID();
    sendLock.current = true; setSending(true); setActionError('');
    const controller = new AbortController(); requestController.current = controller;
    try {
      commit(current => ({ ...current, chats: current.chats.map(chat => chat.id === chatId ? { ...chat, messages: [...chat.messages, { id: localId, text, timestamp: Date.now(), outgoing: true, status: 'sending' }] } : chat) }));
      setDrafts(current => ({ ...current, [chatId]: '' })); nearBottom.current = true;
      const id = await api.send(chatId, text, controller.signal);
      if (!controller.signal.aborted) commit(current => finishSending(current, chatId, localId, id));
    } catch (error) {
      if (controller.signal.aborted) return;
      // A network failure may happen after the server accepts a message. Never
      // resend automatically: a retry could deliver the same text twice.
      safeCommit(current => ({ ...current, chats: current.chats.map(chat => chat.id === chatId ? { ...chat, messages: chat.messages.map(message => message.id === localId ? { ...message, status: 'unknown' } : message) } : chat) }));
      setActionError(`${errorMessage(error)} Перед повторной отправкой проверьте доставку в Telegram.`);
    } finally { sendLock.current = false; setSending(false); composer.current?.focus(); }
  }
  const filtered = state.chats.filter(chat => `${chat.name} ${chat.phone || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <main className={`messenger ${active ? 'has-active-chat' : ''}`}>
    <aside className="sidebar"><header className="sidebar-header"><div className="wordmark"><Brand small /><strong>Telegram</strong></div><button className="icon-button" aria-label="Выйти" title="Выйти" onClick={() => { requestController.current?.abort(); sessionStorage.removeItem(storageKey); onLogout(); }}><LogOut size={21} /></button></header><div className="search"><Search size={19} /><input aria-label="Поиск чатов" placeholder="Поиск" value={search} onChange={event => setSearch(event.target.value)} /></div><div className="list-heading"><span>Сообщения <span className="count">{state.chats.length}</span></span><button className="new-chat-button" onClick={() => setNewChat(true)}><Plus size={17} /> Новый чат</button></div>
      <nav className="chat-list" aria-label="Чаты">{filtered.map(chat => { const last = chat.messages.at(-1); return <button key={chat.id} className={`chat-row ${chat.id === active?.id ? 'selected' : ''}`} onClick={() => select(chat.id)}><Avatar chat={chat} /><div className="chat-row-content"><div className="chat-row-title"><strong>{chat.name}</strong>{last && <time>{time(last.timestamp)}</time>}</div><div className="chat-row-preview"><span>{last ? `${last.outgoing ? 'Вы: ' : ''}${last.text}` : 'Напишите первое сообщение'}</span>{chat.unread > 0 && <b className="unread">{chat.unread}</b>}</div></div></button>; })}{!filtered.length && <div className="empty-list"><MessageCircle size={34} strokeWidth={1.3} /><h3>{search ? 'Ничего не найдено' : 'Здесь будут ваши чаты'}</h3><p>{search ? 'Попробуйте другое имя или номер.' : 'Создайте чат по номеру телефона и начните разговор.'}</p>{!search && <button className="text-button" onClick={() => setNewChat(true)}>Начать общение <ArrowRight size={15} /></button>}</div>}</nav>
      <footer className="sidebar-footer"><span className={`connection-dot ${pollError ? 'warning' : ''}`} /><div><strong>{pollError ? 'Проблема подключения' : 'Инстанс подключён'}</strong><span>GREEN-API · {credentials.idInstance}</span></div><ShieldCheck size={19} /></footer>
    </aside>
    <section className="conversation" aria-label="Переписка">{active ? <><header className="conversation-header"><button className="icon-button back-button" aria-label="Назад к чатам" onClick={() => select(null)}><ArrowLeft /></button><Avatar chat={active} /><div><h1>{active.name}</h1><p>{active.phone ? `+${active.phone} · Telegram` : 'Telegram'}</p></div><span className="text-only"><MessageCircle size={16} /> Текстовые сообщения</span></header>
      {pollError && <div className="poll-error"><Alert>{pollError} Получение будет возобновлено после восстановления соединения; при ошибке доступа войдите заново.</Alert></div>}
      <div className="message-area" ref={scrollArea} role="log" aria-label="Сообщения" aria-live="polite" onScroll={event => { const element = event.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}><div className="message-column">{!active.messages.length && <div className="conversation-start"><span>👋</span><h2>Начните с «Привет!»</h2><p>Здесь появятся ваши сообщения<br />и ответы собеседника.</p></div>}{active.messages.map((message, index) => <div key={message.id} className="message-group">{(index === 0 || day(active.messages[index - 1].timestamp) !== day(message.timestamp)) && <div className="date-separator"><span>{day(message.timestamp)}</span></div>}<div className={`message ${message.outgoing ? 'outgoing' : 'incoming'}`}><div className="message-text">{message.text}</div><div className="message-meta"><time>{time(message.timestamp)}</time>{message.outgoing && <span title={statuses[message.status]} aria-label={statuses[message.status]} className={`message-status ${message.status}`}>{['unknown', 'failed'].includes(message.status) ? <CircleAlert size={15} /> : message.status === 'sending' || message.status === 'queued' ? <Clock3 size={14} /> : message.status === 'read' || message.status === 'delivered' ? <CheckCheck size={17} /> : <Check size={16} />}</span>}</div></div>{['unknown', 'failed'].includes(message.status) && <div className="failed-note">{statuses[message.status]}</div>}</div>)}</div></div>
      <div className="composer-area">{actionError && <Alert>{actionError}</Alert>}<form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}><textarea ref={composer} aria-label="Сообщение" placeholder="Сообщение" value={draft} rows={1} onChange={event => setDrafts(current => ({ ...current, [active.id]: event.target.value })) onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><button className="send-button" aria-label="Отправить сообщение" disabled={!draft.trim() || draft.length > 4096 || sending}><Send size={23} fill="currentColor" strokeWidth={1.4} /></button></form><div className={`composer-hint ${draft.length > 4096 ? 'over-limit' : ''}`}><span>Enter — отправить · Shift + Enter — новая строка</span><span>{draft.length} / 4096</span></div></div>
    </> : <>{pollError && <div className="poll-error"><Alert>{pollError}</Alert></div>}<div className="welcome-chat"><div className="welcome-icon"><Send size={48} fill="currentColor" strokeWidth={1} /></div><h1>Хороший разговор<br />начинается с сообщения</h1><p>Выберите чат слева или создайте новый,<br />чтобы написать собеседнику в Telegram.</p><button className="primary" onClick={() => setNewChat(true)}><Plus size={19} /> Новый чат</button><span className="welcome-caption">Ваши сообщения. Ваши разговоры.</span></div></> }</section>
    {newChat && <NewChat api={api} onClose={() => setNewChat(false)} onCreate={chat => { commit(current => ({ ...current, activeId: chat.id, chats: current.chats.some(item => item.id === chat.id) ? current.chats.map(item => item.id === chat.id ? { ...item, unread: 0 } : item) : [chat, ...current.chats] })); nearBottom.current = true; setNewChat(false); }} />}
  </main>;
}

export default function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  return credentials ? <ChatApp credentials={credentials} onLogout={() => setCredentials(null)} /> : <Login onConnect={setCredentials} />;
}
