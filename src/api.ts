export interface Credentials { idInstance: string; apiTokenInstance: string; apiUrl: string }
export interface Notification { receiptId: number; body: Record<string, unknown> }

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

export function normalizePhone(value: string): string {
  if (!/^\+?[\d\s()-]+$/.test(value.trim())) throw new Error('Введите номер телефона в международном формате.');
  const phone = value.replace(/\D/g, '');
  if (!/^[1-9]\d{6,14}$/.test(phone)) throw new Error('Укажите от 7 до 15 цифр, начиная с кода страны.');
  return phone;
}

export function validateCredentials(value: Credentials): Credentials {
  const idInstance = value.idInstance.trim();
  const apiTokenInstance = value.apiTokenInstance.trim();
  if (!/^\d{4,}$/.test(idInstance)) throw new Error('idInstance должен содержать только цифры (минимум 4).');
  if (!/^[a-zA-Z0-9_-]+$/.test(apiTokenInstance)) throw new Error('Проверьте apiTokenInstance: пробелы и специальные символы недопустимы.');
  const apiUrl = value.apiUrl.trim() || `https://${idInstance.slice(0, 4)}.api.green-api.com`;
  let url: URL;
  try { url = new URL(apiUrl); } catch { throw new Error('Проверьте адрес apiUrl из личного кабинета.'); }
  if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*green-api\.com$/.test(url.hostname) || url.username || url.password || url.search || url.hash || url.port || url.pathname !== '/') {
    throw new Error('Укажите HTTPS-адрес сервера GREEN-API без пути, например https://4100.api.green-api.com.');
  }
  return { idInstance, apiTokenInstance, apiUrl: url.origin };
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.';
}

export class GreenApi {
  constructor(readonly credentials: Credentials) {}

  private async request<T>(method: string, verb = 'GET', body?: unknown, signal?: AbortSignal, suffix = ''): Promise<T> {
    const { apiUrl, idInstance, apiTokenInstance } = this.credentials;
    const timeout = AbortSignal.timeout(45_000);
    try {
      const response = await fetch(`${apiUrl}/waInstance${idInstance}/${method}/${apiTokenInstance}${suffix}`, {
        method: verb, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      });
      if (!response.ok) {
        const messages: Record<number, string> = {
          400: 'GREEN-API отклонил параметры запроса. Проверьте введённые данные.',
          401: 'Неверные данные доступа. Проверьте idInstance и apiTokenInstance.',
          403: 'Доступ запрещён. Проверьте токен и тариф инстанса.',
          404: 'Инстанс или сервер не найден. Проверьте idInstance и apiUrl.',
          429: 'Слишком много запросов. Подождите перед повторной попыткой.',
          469: 'Telegram временно ограничил поиск номеров. Повторите позже.',
        };
        throw new ApiError(messages[response.status] ?? `Сервис временно недоступен (HTTP ${response.status}).`, response.status);
      }
      return await response.json() as T;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof ApiError) throw error;
      if (timeout.aborted) throw new ApiError('Сервер не ответил вовремя. Проверьте соединение.');
      throw new ApiError('Не удалось связаться с GREEN-API. Проверьте интернет и apiUrl.');
    }
  }

  async connect(signal?: AbortSignal) {
    const state = await this.request<{ stateInstance: string }>('getStateInstance', 'GET', undefined, signal);
    if (state.stateInstance !== 'authorized') throw new Error('Авторизуйте Telegram-инстанс в личном кабинете GREEN-API и повторите подключение.');
    const settings = await this.request<{ webhookUrl?: string; incomingWebhook?: string }>('getSettings', 'GET', undefined, signal);
    if (settings.webhookUrl || settings.incomingWebhook !== 'yes') {
      throw new Error('В настройках инстанса включите incomingWebhook и оставьте webhookUrl пустым. Затем повторите подключение.');
    }
  }

  async findContact(phone: string, signal?: AbortSignal) {
    const result = await this.request<{ exist?: boolean; chatId?: string; username?: string; status?: boolean }>('checkAccount', 'POST', { phoneNumber: Number(phone) }, signal);
    if (result.status === false) throw new Error('Не удалось проверить номер. Проверьте состояние инстанса и лимит проверок в GREEN-API.');
    if (!result.exist || !result.chatId) throw new Error('Аккаунт не найден или номер скрыт настройками приватности Telegram.');
    return { id: result.chatId, name: result.username || `+${phone}`, phone };
  }

  async send(chatId: string, message: string, signal?: AbortSignal) {
    const result = await this.request<{ idMessage: string }>('sendMessage', 'POST', { chatId, message }, signal);
    if (!result.idMessage) throw new Error('GREEN-API не вернул ID сообщения. Проверьте доставку в Telegram перед повторной отправкой.');
    return result.idMessage;
  }

  receive(signal: AbortSignal) {
    return this.request<Notification | null>('receiveNotification', 'GET', undefined, signal, '?receiveTimeout=30');
  }

  async acknowledge(receiptId: number, signal: AbortSignal) {
    const result = await this.request<{ result: boolean }>('deleteNotification', 'DELETE', undefined, signal, `/${receiptId}`);
    // false also means a previous DELETE succeeded but its response was lost.
    // The event has already been saved locally, so it is safe to continue.
    if (typeof result.result !== 'boolean') throw new Error('Не удалось подтвердить обработку уведомления.');
  }
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

// Exactly one receive/acknowledge cycle is in flight. Failed acknowledgements are
// retried before reading another event; processing never silently loses an event.
export async function pollNotifications(api: Pick<GreenApi, 'receive' | 'acknowledge'>, signal: AbortSignal, onEvent: (body: Record<string, unknown>) => void, onStatus: (error: string | null) => void) {
  let pending: Notification | null = null;
  let processed = false;
  let failures = 0;
  while (!signal.aborted) {
    try {
      if (!pending) pending = await api.receive(signal);
      if (signal.aborted) return;
      if (pending) {
        if (!processed) { onEvent(pending.body); processed = true; }
        await api.acknowledge(pending.receiptId, signal);
        pending = null;
        processed = false;
      }
      if (signal.aborted) return;
      failures = 0;
      onStatus(null);
      await delay(250, signal);
    } catch (error) {
      if (signal.aborted) return;
      onStatus(errorMessage(error));
      if (error instanceof ApiError && [401, 403].includes(error.status)) return;
      await delay(Math.min(1000 * 2 ** failures++, 30_000), signal);
    }
  }
}
