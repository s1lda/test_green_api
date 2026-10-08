import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CheckCheck,
  ChevronDown,
  Eye,
  EyeOff,
  MessageCircle,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { errorMessage, GreenApi, validateCredentials, type Credentials } from '../api';
import { Alert, Brand } from './ui';

export default function Login({ onConnect }: { onConnect: (credentials: Credentials) => void }) {
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    controller.current = new AbortController();
    try {
      const credentials = validateCredentials({
        idInstance: String(form.get('idInstance')),
        apiTokenInstance: String(form.get('apiTokenInstance')),
        apiUrl: String(form.get('apiUrl') || ''),
      });
      await new GreenApi(credentials).connect(controller.current.signal);
      if (!controller.current.signal.aborted) onConnect(credentials);
    } catch (err) {
      if (!controller.current?.signal.aborted) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <header className="landing-header">
        <div className="wordmark">
          <Brand small />
          <span>
            Telegram <span className="wordmark-light">/ GREEN-API</span>
          </span>
        </div>
        <a href="https://green-api.com/telegram/docs/" target="_blank" rel="noreferrer">
          Документация <ArrowRight size={15} />
        </a>
      </header>
      <div className="login-layout">
        <section className="intro">
          <span className="eyebrow">
            <span /> ПРОСТО ОСТАВАЙТЕСЬ НА СВЯЗИ
          </span>
          <h1>
            Ваш Telegram.
            <br />
            Ничего лишнего.
          </h1>
          <p className="intro-copy">
            Простой чат для важных разговоров.
            <br />
            Отправляйте сообщения и получайте ответы
            <br className="desktop-break" /> в одном знакомом интерфейсе.
          </p>
          <div className="chat-preview" aria-hidden="true">
            <div className="preview-top">
              <div className="preview-avatar">А</div>
              <div>
                <strong>Александра</strong>
                <span>Пример переписки</span>
              </div>
              <span className="preview-dot" />
            </div>
            <div className="preview-messages">
              <div className="preview-date">Сегодня</div>
              <div className="preview-bubble incoming">
                Привет! Как продвигается проект?<small>12:40</small>
              </div>
              <div className="preview-bubble outgoing">
                Привет! Всё готово, давай обсудим ✨
                <small>
                  12:41 <CheckCheck size={14} />
                </small>
              </div>
              <div className="preview-bubble incoming short">
                Отлично, я на связи!<small>12:42</small>
              </div>
            </div>
            <div className="preview-input">
              Сообщение{' '}
              <span>
                <Send size={18} />
              </span>
            </div>
          </div>
          <div className="intro-note">
            <MessageCircle size={17} /> Только текст. Только общение.
          </div>
        </section>
        <section className="login-card">
          <Brand />
          <h2>Добро пожаловать</h2>
          <p className="card-copy">
            Подключите свой Telegram-инстанс,
            <br />
            чтобы начать общение.
          </p>
          <form onSubmit={submit}>
            <label htmlFor="idInstance">ID инстанса</label>
            <input
              id="idInstance"
              name="idInstance"
              placeholder="Например, 4100123456"
              inputMode="numeric"
              autoComplete="off"
              required
              disabled={busy}
            />
            <p className="field-hint">idInstance из личного кабинета GREEN-API</p>
            <label htmlFor="apiTokenInstance">API-токен</label>
            <div className="password-field">
              <input
                id="apiTokenInstance"
                name="apiTokenInstance"
                type={showToken ? 'text' : 'password'}
                placeholder="Ваш apiTokenInstance"
                autoComplete="off"
                required
                disabled={busy}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            <details className="advanced">
              <summary>
                Настройки сервера <ChevronDown size={15} />
              </summary>
              <label htmlFor="apiUrl">Адрес API</label>
              <input
                id="apiUrl"
                name="apiUrl"
                type="url"
                placeholder="https://4100.api.green-api.com"
                disabled={busy}
              />
              <p className="field-hint">
                Оставьте пустым для определения по ID. Если адрес отличается, скопируйте apiUrl из
                кабинета.
              </p>
            </details>
            {error && <Alert>{error}</Alert>}
            <button className="primary connect-button" disabled={busy}>
              {busy ? 'Подключаемся…' : 'Подключиться'}
              {!busy && <ArrowRight size={19} />}
            </button>
          </form>
          <div className="privacy">
            <ShieldCheck size={17} />
            <span>Токен хранится только в памяти вкладки</span>
          </div>
          <div className="card-footer">
            Нет инстанса?{' '}
            <a href="https://console.green-api.com/" target="_blank" rel="noreferrer">
              Создать в GREEN-API <ArrowRight size={13} />
            </a>
          </div>
        </section>
      </div>
      <footer className="landing-footer">
        <span>Тестовое задание · React + GREEN-API</span>
        <span>Сделано для простого общения</span>
      </footer>
    </main>
  );
}
