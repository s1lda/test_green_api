import { test, expect, type Page } from '@playwright/test';

async function mockApi(page: Page, options: { failedSend?: boolean; invalidLogin?: boolean } = {}) {
  const sent: unknown[] = [];
  let replyReady = false;
  let acknowledged = false;
  await page.route('https://*.api.green-api.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/getStateInstance/'))
      return route.fulfill({
        status: options.invalidLogin ? 401 : 200,
        json: { stateInstance: 'authorized' },
      });
    if (url.includes('/getSettings/'))
      return route.fulfill({ json: { incomingWebhook: 'yes', webhookUrl: '' } });
    if (url.includes('/checkAccount/'))
      return route.fulfill({ json: { exist: true, chatId: '12345', username: '@alexandra' } });
    if (url.includes('/sendMessage/')) {
      sent.push(route.request().postDataJSON());
      if (options.failedSend) return route.fulfill({ status: 500, json: {} });
      replyReady = true;
      return route.fulfill({ json: { idMessage: 'out-1' } });
    }
    if (url.includes('/receiveNotification/'))
      return route.fulfill({
        json:
          replyReady && !acknowledged
            ? {
                receiptId: 42,
                body: {
                  typeWebhook: 'incomingMessageReceived',
                  timestamp: Math.floor(Date.now() / 1000),
                  idMessage: 'in-1',
                  senderData: { chatId: '12345', chatName: 'Александра' },
                  messageData: {
                    typeMessage: 'textMessage',
                    textMessageData: { textMessage: 'Привет! Сообщение получила 👋' },
                  },
                },
              }
            : null,
      });
    if (url.includes('/deleteNotification/')) {
      acknowledged = true;
      return route.fulfill({ json: { result: true } });
    }
    throw new Error(`Unexpected API method: ${new URL(url).pathname.split('/')[2]}`);
  });
  return { sent, isAcknowledged: () => acknowledged };
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('ID инстанса', { exact: true }).fill('4100123456');
  await page.getByLabel('API-токен', { exact: true }).fill('fake-test-token');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
}

async function createChat(page: Page) {
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click();
  await page.getByLabel('Номер телефона').fill('+7 (999) 123-45-67');
  await page.getByRole('button', { name: 'Начать общение', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: '@alexandra' })).toBeVisible();
}

test('complete chat flow, storage, search, reload and logout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const api = await mockApi(page);
  await page.goto('/');
  await page.screenshot({ path: '.artifacts/login-desktop.png', fullPage: true });
  await login(page);
  await createChat(page);
  const composer = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled();
  await composer.fill('Привет! Как продвигается проект?');
  await composer.press('Enter');
  await expect(
    page.getByRole('log').getByText('Привет! Сообщение получила 👋', { exact: true }),
  ).toBeVisible();
  await expect.poll(api.isAcknowledged).toBe(true);
  expect(api.sent).toEqual([{ chatId: '12345', message: 'Привет! Как продвигается проект?' }]);
  await page.screenshot({ path: '.artifacts/chat-desktop.png', fullPage: true });
  const storage = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
  expect(storage).not.toContain('fake-test-token');
  await page.getByRole('textbox', { name: 'Поиск чатов' }).fill('unknown');
  await expect(page.getByText('Ничего не найдено')).toBeVisible();
  await login(page); // Reload requires credentials but retains this tab's messages.
  await expect(
    page.getByRole('log').getByText('Привет! Сообщение получила 👋', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Добро пожаловать' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('mobile navigation, multiline drafts and message length', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto('/');
  await page.screenshot({ path: '.artifacts/login-mobile.png', fullPage: true });
  await login(page);
  await createChat(page);
  const composer = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await composer.fill('Первая строка');
  await composer.press('Shift+Enter');
  await composer.pressSequentially('Вторая строка');
  await expect(composer).toHaveValue('Первая строка\nВторая строка');
  await composer.fill('x'.repeat(4097));
  await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled();
  await composer.fill('Привет с телефона!');
  await composer.press('Enter');
  await expect(
    page.getByRole('log').getByText('Привет! Сообщение получила 👋', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '.artifacts/chat-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Назад к чатам' }).click();
  await expect(page.getByRole('textbox', { name: 'Поиск чатов' })).toBeVisible();
});

test('login error is visible', async ({ page }) => {
  await mockApi(page, { invalidLogin: true });
  await login(page);
  await expect(page.getByRole('alert')).toContainText('Неверные данные доступа');
});

test('send failure stays visible and is not automatically retried', async ({ page }) => {
  const api = await mockApi(page, { failedSend: true });
  await login(page);
  await createChat(page);
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Проверка ошибки');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.getByRole('alert')).toContainText('HTTP 500');
  await expect(page.getByRole('log').getByText('Проверка ошибки', { exact: true })).toBeVisible();
  expect(api.sent).toHaveLength(1);
});
