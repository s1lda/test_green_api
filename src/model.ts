export type MessageStatus = 'sending' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown';
export interface Message { id: string; text: string; timestamp: number; outgoing: boolean; status: MessageStatus }
export interface Chat { id: string; name: string; phone?: string; messages: Message[]; unread: number }
export interface ChatState { chats: Chat[]; activeId: string | null }
export const emptyState: ChatState = { chats: [], activeId: null };

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';
const rank: Record<MessageStatus, number> = { sending: 0, unknown: 0, queued: 1, sent: 2, delivered: 3, read: 4, failed: 5 };

export function applyNotification(state: ChatState, body: Record<string, unknown>): ChatState {
  const type = string(body.typeWebhook);
  const id = string(body.idMessage);
  if (type === 'outgoingMessageStatus') {
    const status = string(body.status) === 'noAccount' ? 'failed' : string(body.status);
    if (!(status in rank) || !id) return state;
    return { ...state, chats: state.chats.map(chat => chat.id === body.chatId ? { ...chat, messages: chat.messages.map(message => message.id === id && rank[status as MessageStatus] >= rank[message.status] ? { ...message, status: status as MessageStatus } : message) } : chat) };
  }
  if (!['incomingMessageReceived', 'outgoingMessageReceived', 'outgoingAPIMessageReceived'].includes(type)) return state;
  const sender = record(body.senderData);
  const data = record(body.messageData);
  const chatId = string(sender.chatId);
  const text = data.typeMessage === 'textMessage' ? string(record(data.textMessageData).textMessage) : data.typeMessage === 'extendedTextMessage' ? string(record(data.extendedTextMessageData).text) : '';
  if (!id || !chatId || !text) return state;
  const outgoing = type !== 'incomingMessageReceived';
  let chat = state.chats.find(item => item.id === chatId);
  if (chat?.messages.some(item => item.id === id)) return state;
  if (!chat) chat = { id: chatId, name: string(sender.chatName) || string(sender.senderName) || chatId, messages: [], unread: 0 };
  const message: Message = { id, text, timestamp: typeof body.timestamp === 'number' ? body.timestamp * 1000 : Date.now(), outgoing, status: outgoing ? 'sent' : 'delivered' };
  chat = { ...chat, messages: [...chat.messages, message].sort((a, b) => a.timestamp - b.timestamp), unread: chat.unread + (!outgoing && state.activeId !== chatId ? 1 : 0) };
  return { ...state, chats: [chat, ...state.chats.filter(item => item.id !== chatId)] };
}

export function finishSending(state: ChatState, chatId: string, localId: string, serverId: string): ChatState {
  return { ...state, chats: state.chats.map(chat => {
    if (chat.id !== chatId) return chat;
    const echoed = chat.messages.find(message => message.id === serverId);
    return { ...chat, messages: chat.messages.filter(message => message.id !== serverId).map(message => message.id === localId ? { ...message, id: serverId, status: echoed?.status ?? 'queued' } : message) };
  }) };
}

export function readState(key: string): ChatState {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) || 'null') as ChatState | null;
    if (!stored || !Array.isArray(stored.chats)) return emptyState;
    return { ...stored, chats: stored.chats.map(chat => ({ ...chat, messages: chat.messages.map(message => message.status === 'sending' ? { ...message, status: 'unknown' } : message) })) };
  } catch { return emptyState; }
}

export function saveState(key: string, state: ChatState) {
  try { sessionStorage.setItem(key, JSON.stringify(state)); }
  catch { throw new Error('Не удалось сохранить сообщения в этой вкладке. Освободите место в хранилище браузера. Получение приостановлено до успешного сохранения.'); }
}
