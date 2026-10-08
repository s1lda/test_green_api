import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  GreenApi,
  normalizePhone,
  pollNotifications,
  validateCredentials,
} from '../src/api';
import { applyNotification, emptyState, finishSending, type ChatState } from '../src/model';

const credentials = {
  idInstance: '4100123456',
  apiTokenInstance: 'test-token',
  apiUrl: 'https://4100.api.green-api.com',
};
const body = {
  typeWebhook: 'incomingMessageReceived',
  idMessage: 'reply-1',
  timestamp: 1_700_000_000,
  senderData: { chatId: '12345', chatName: 'Анна' },
  messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Привет!' } },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('credentials and API contract', () => {
  it('normalizes international phone numbers and rejects invalid input', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('79991234567');
    for (const phone of ['123', 'abc79991234567', '0000000000', '7+9991234567'])
      expect(() => normalizePhone(phone)).toThrow();
  });
  it('derives the cluster and refuses to send a token to other domains', () => {
    expect(validateCredentials({ ...credentials, apiUrl: '' }).apiUrl).toBe(credentials.apiUrl);
    for (const apiUrl of [
      'http://4100.api.green-api.com',
      'https://green-api.com.evil.com',
      'https://evil.com',
      'https://user:pass@green-api.com',
      'https://green-api.com/path',
    ])
      expect(() => validateCredentials({ ...credentials, apiUrl })).toThrow();
  });
  it('uses canonical Telegram chat ID and the documented send payload', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ exist: true, chatId: '12345' }))
      .mockResolvedValueOnce(Response.json({ idMessage: 'sent-1' }));
    vi.stubGlobal('fetch', fetcher);
    const api = new GreenApi(credentials);
    const contact = await api.findContact('79991234567');
    await api.send(contact.id, 'Текст');
    expect(fetcher.mock.calls[0][1].body).toBe(JSON.stringify({ phoneNumber: 79991234567 }));
    expect(fetcher.mock.calls[1][0]).toBe(
      `${credentials.apiUrl}/waInstance4100123456/sendMessage/test-token`,
    );
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      chatId: '12345',
      message: 'Текст',
    });
  });
  it('does not expose server response bodies or credentials in errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('secret token test-token', { status: 401 })),
    );
    await expect(new GreenApi(credentials).connect()).rejects.toThrow('Неверные данные доступа');
  });
  it('rejects incompatible webhook settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ stateInstance: 'authorized' }))
        .mockResolvedValueOnce(Response.json({ incomingWebhook: 'no', webhookUrl: '' })),
    );
    await expect(new GreenApi(credentials).connect()).rejects.toThrow('incomingWebhook');
  });
});

describe('notification processing', () => {
  it('creates incoming chats, deduplicates repeated events, and counts unread once', () => {
    const state = applyNotification(emptyState, body);
    expect(state.chats[0].messages[0].text).toBe('Привет!');
    expect(state.chats[0].unread).toBe(1);
    expect(applyNotification(state, body)).toBe(state);
  });
  it('keeps replies in the chat created from the resolved Telegram ID', () => {
    const state: ChatState = {
      activeId: '12345',
      chats: [{ id: '12345', name: '+79991234567', phone: '79991234567', messages: [], unread: 0 }],
    };
    const next = applyNotification(state, body);
    expect(next.chats).toHaveLength(1);
    expect(next.chats[0].unread).toBe(0);
    expect(next.chats[0].messages).toHaveLength(1);
  });
  it('handles extended text and ignores unsupported media', () => {
    expect(
      applyNotification(emptyState, {
        ...body,
        messageData: {
          typeMessage: 'extendedTextMessage',
          extendedTextMessageData: { text: 'https://example.com' },
        },
      }).chats[0].messages[0].text,
    ).toBe('https://example.com');
    expect(
      applyNotification(emptyState, { ...body, messageData: { typeMessage: 'imageMessage' } }),
    ).toBe(emptyState);
  });
  it('merges an outgoing echo arriving before the send response', () => {
    const state: ChatState = {
      activeId: '12345',
      chats: [
        {
          id: '12345',
          name: 'Анна',
          unread: 0,
          messages: [
            { id: 'local', text: 'Привет!', timestamp: 1, outgoing: true, status: 'sending' },
          ],
        },
      ],
    };
    const echoed = applyNotification(state, {
      ...body,
      typeWebhook: 'outgoingAPIMessageReceived',
      idMessage: 'server',
    });
    const next = finishSending(echoed, '12345', 'local', 'server');
    expect(next.chats[0].messages).toHaveLength(1);
    expect(next.chats[0].messages[0].id).toBe('server');
  });
  it('does not downgrade read status on late delivery events', () => {
    const state = applyNotification(emptyState, {
      ...body,
      typeWebhook: 'outgoingAPIMessageReceived',
    });
    const read = applyNotification(state, {
      typeWebhook: 'outgoingMessageStatus',
      chatId: '12345',
      idMessage: 'reply-1',
      status: 'read',
    });
    const late = applyNotification(read, {
      typeWebhook: 'outgoingMessageStatus',
      chatId: '12345',
      idMessage: 'reply-1',
      status: 'delivered',
    });
    expect(late.chats[0].messages[0].status).toBe('read');
  });
  it('updates a queued message from its outgoing echo without duplication', () => {
    const state = applyNotification(emptyState, {
      ...body,
      typeWebhook: 'outgoingAPIMessageReceived',
    });
    state.chats[0].messages[0].status = 'queued';
    const updated = applyNotification(state, {
      ...body,
      typeWebhook: 'outgoingAPIMessageReceived',
    });
    expect(updated.chats[0].messages).toHaveLength(1);
    expect(updated.chats[0].messages[0].status).toBe('sent');
  });
});

describe('sequential queue polling', () => {
  it('retries a failed acknowledgement without repeating processing or receiving the next event', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const order: string[] = [];
    const api = {
      receive: vi.fn(async () => {
        order.push('receive');
        return { receiptId: 7, body };
      }),
      acknowledge: vi
        .fn()
        .mockImplementationOnce(async () => {
          order.push('ack-fail');
          throw new Error('network');
        })
        .mockImplementationOnce(async () => {
          order.push('ack');
          controller.abort();
        }),
    };
    const process = vi.fn(() => {
      order.push('process');
    });
    const run = pollNotifications(api, controller.signal, process, vi.fn());
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(order).toEqual(['receive', 'process', 'ack-fail', 'ack']);
    expect(process).toHaveBeenCalledTimes(1);
  });
  it('does not acknowledge messages if saving fails', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const api = { receive: vi.fn(async () => ({ receiptId: 7, body })), acknowledge: vi.fn() };
    const run = pollNotifications(
      api,
      controller.signal,
      () => {
        throw new Error('storage full');
      },
      () => controller.abort(),
    );
    await run;
    expect(api.acknowledge).not.toHaveBeenCalled();
  });
  it('stops polling on invalid credentials', async () => {
    const controller = new AbortController();
    const api = {
      receive: vi.fn(async () => {
        throw new ApiError('unauthorized', 401);
      }),
      acknowledge: vi.fn(),
    };
    await pollNotifications(api, controller.signal, vi.fn(), vi.fn());
    expect(api.receive).toHaveBeenCalledTimes(1);
  });
});
