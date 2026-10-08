import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, MessageCircle, X } from 'lucide-react';
import { errorMessage, GreenApi, normalizePhone } from '../api';
import type { Chat } from '../model';
import { Alert } from './ui';

export default function NewChat({
  api,
  onCreate,
  onClose,
}: {
  api: GreenApi;
  onCreate: (chat: Chat) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => controller.current?.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    controller.current = new AbortController();
    try {
      const phone = normalizePhone(String(new FormData(event.currentTarget).get('phone')));
      const contact = await api.findContact(phone, controller.current.signal);
      if (!controller.current.signal.aborted) onCreate({ ...contact, messages: [], unread: 0 });
    } catch (err) {
      if (!controller.current?.signal.aborted) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <div className="dialog-icon">
          <MessageCircle />
        </div>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X />
        </button>
      </div>
      <h2>Новый чат</h2>
      <p className="muted">Введите номер собеседника в Telegram.</p>
      <form onSubmit={submit}>
        <label htmlFor="phone">Номер телефона</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          placeholder="+7 999 123-45-67"
          required
          autoFocus
          disabled={busy}
        />
        <p className="field-hint">В международном формате, с кодом страны</p>
        {error && <Alert>{error}</Alert>}
        <button className="primary" disabled={busy}>
          {busy ? 'Ищем собеседника…' : 'Начать общение'}
          <ArrowRight size={18} />
        </button>
      </form>
    </dialog>
  );
}
