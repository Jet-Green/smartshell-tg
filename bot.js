import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import connectDB from './db.js';
import User from './models/user.model.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const app = express();

const SMARTSHELL_API_URL = process.env.SMARTSHELL_API_URL;
const CLUB_ID = parseInt(process.env.CLUB_ID, 10);
const REQUIRED_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID;
const SUBSCRIBE_URL = process.env.SUBSCRIBE_URL;

if (!REQUIRED_CHANNEL_ID) {
  console.error("Критическая ошибка: Переменная REQUIRED_CHANNEL_ID не установлена в .env файле!");
  process.exit(1); // Завершаем работу, если канал не указан
}

// Простое хранилище состояний для многошаговых диалогов
let userStates = {};

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "💰 Баланс" }, { text: "💳 Пополнить" }],
      [{ text: "🔑 Авторизация" }]
    ],
    resize_keyboard: true,
  },
};

// --- GraphQL Запросы (константы для чистоты кода) ---
const LOGIN_MUTATION = `
mutation clientLogin($input: ClientLoginInput!) {
  clientLogin(input: $input) {
    access_token
  }
}`;

const MY_CLUB_QUERY = `
query myClub($id: Int!) {
  myClub(id: $id) {
    deposit
    user_bonus
  }
}`;

const CREATE_PAYMENT_MUTATION = `
mutation createPaymentTransaction($input: PaymentTransactionInput!) {
  createPaymentTransaction(input: $input) {
    additional {
      data
    }
  }
}`;

async function callSmartshellAPI(query, variables, accessToken = null) {
  const headers = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  try {
    const response = await axios.post(SMARTSHELL_API_URL, {
      query,
      variables,
    }, { headers });

    if (response.data.errors) {
      // console.error('GraphQL Error:', response.data.errors);
      throw new Error(response.data.errors[0].message);
    }
    return response.data.data;
  } catch (error) {
    // console.error('API Call Failed:', error.message);
    throw error;
  }
}
/**
 * Функция-проверка подписки на канал.
 * @param {number} userId ID пользователя для проверки.
 * @returns {Promise<boolean>} true, если подписан, иначе false.
 */
async function isUserSubscribed(userId) {
  try {
    const member = await bot.getChatMember(REQUIRED_CHANNEL_ID, userId);
    const validStatuses = ['creator', 'administrator', 'member'];
    return validStatuses.includes(member.status);
  } catch (error) {
    // Если API возвращает ошибку (например, "user not found"),
    // это значит, что пользователь точно не является участником.
    return false;
  }
}

/**
 * Отправляет сообщение с просьбой подписаться.
 * @param {number} chatId ID чата, куда отправить сообщение.
 */
function sendSubscriptionMessage(chatId) {
  const channelUsername = REQUIRED_CHANNEL_ID.startsWith('@') ? REQUIRED_CHANNEL_ID.substring(1) : '';
  bot.sendMessage(
    chatId,
    "❗️ Для использования бота, пожалуйста, подпишитесь на наш канал.", {
    reply_markup: {
      inline_keyboard: [
        [{
          text: "➡️ Подписаться на канал",
          url: `${SUBSCRIBE_URL}`
        }],
        [{
          text: "✅ Я подписался и согласен на обработку персональных данных",
          callback_data: "check_subscription"
        }]
      ]
    }
  }
  );
}


bot.on('callback_query', async (callbackQuery) => {
  const { data, message } = callbackQuery;
  const chatId = message.chat.id;
  const userId = callbackQuery.from.id;

  if (data === 'check_subscription') {
    const isSubscribed = await isUserSubscribed(userId);
    if (isSubscribed) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "Спасибо за подписку!" });
      await bot.deleteMessage(chatId, message.message_id); // Удаляем сообщение с просьбой
      await bot.sendMessage(chatId, `👋 Добро пожаловать! Теперь вы можете использовать все функции бота.`, mainKeyboard);
    } else {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "Подписка не найдена. Пожалуйста, подпишитесь и попробуйте снова.",
        show_alert: true
      });
    }
  }
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { step: 'awaiting_login' };
  bot.sendMessage(
    chatId,
    `👋 Добро пожаловать в бот для клуба!\n\nИспользуйте меню ниже для навигации.`,
    mainKeyboard
  );
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = msg.from.id;

  // Сначала проверяем подписку
  if (!(await isUserSubscribed(userId))) {
    sendSubscriptionMessage(chatId);
    return; // Прерываем выполнение, если не подписан
  }

  if (text.startsWith('/')) return;

  const state = userStates[chatId];
  if (state) {
    if (state.step === 'awaiting_login') {
      state.login = text;
      state.step = 'awaiting_password';
      bot.sendMessage(chatId, "Отлично, теперь введите ваш пароль от аккаунта Smartshell.");
    } else if (state.step === 'awaiting_password') {
      const { login } = state;
      const password = text;
      delete userStates[chatId];

      bot.sendMessage(chatId, "Проверяю данные, пожалуйста, подождите...");

      try {
        const data = await callSmartshellAPI(LOGIN_MUTATION, { input: { login, password } });
        const accessToken = data.clientLogin.access_token;

        await User.findOneAndUpdate(
          { telegramId: chatId },
          {
            telegramId: chatId,
            firstName: msg.from.first_name,
            smartshellLogin: login,
            accessToken: accessToken,
            clubId: CLUB_ID,
          },
          { upsert: true, new: true }
        );

        bot.sendMessage(chatId, "✅ Авторизация прошла успешно!", mainKeyboard);
      } catch (error) {
        bot.sendMessage(chatId, "❌ Ошибка авторизации. Проверьте логин и пароль и попробуйте снова.", mainKeyboard);
      }
    } else if (state.step === 'awaiting_amount') {
      const amount = parseInt(text, 10);
      delete userStates[chatId];

      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, "❌ Некорректная сумма. Пожалуйста, введите целое положительное число.", mainKeyboard);
        return;
      }

      try {
        const user = await User.findOne({ telegramId: chatId });
        if (!user || !user.accessToken) {
          bot.sendMessage(chatId, "Сначала нужно авторизоваться. Нажмите '🔑 Авторизация'.", mainKeyboard);
          return;
        }

        bot.sendMessage(chatId, "Генерирую ссылку на оплату...");

        const variables = {
          input: {
            company_id: user.clubId,
            service: "SBP",
            amount: amount,
            return_format: "LINK",
            success_url: "https://t.me/" + (await bot.getMe()).username,
            fail_url: "https://t.me/" + (await bot.getMe()).username,
          }
        };

        const data = await callSmartshellAPI(CREATE_PAYMENT_MUTATION, variables, user.accessToken);
        const paymentLink = data.createPaymentTransaction.additional.data;

        bot.sendMessage(chatId, "Ваша ссылка для пополнения баланса:", {
          reply_markup: {
            inline_keyboard: [
              [{ text: `Оплатить ${amount} руб.`, url: paymentLink }]
            ]
          }
        });

      } catch (error) {
        bot.sendMessage(chatId, "❌ Не удалось создать ссылку на оплату. Возможно, нужно авторизоваться заново.", mainKeyboard);
      }
    }
    return;
  }

  switch (text) {
    case '🔑 Авторизация':
      userStates[chatId] = { step: 'awaiting_login' };
      bot.sendMessage(chatId, "Пожалуйста, введите ваш логин от аккаунта Smartshell (номер телефона, начиная с 7)");
      break;

    case '💰 Баланс':
      try {
        const user = await User.findOne({ telegramId: chatId });
        if (!user || !user.accessToken) {
          bot.sendMessage(chatId, "Сначала нужно авторизоваться. Нажмите '🔑 Авторизация'.");
          return;
        }

        bot.sendMessage(chatId, "Запрашиваю информацию о балансе...");
        const data = await callSmartshellAPI(MY_CLUB_QUERY, { id: user.clubId }, user.accessToken);
        const { deposit, user_bonus } = data.myClub;

        bot.sendMessage(chatId, `ℹ️ Ваш баланс:\n\n▫️ Депозит: ${deposit} руб.\n▫️ Бонусы: ${user_bonus} руб.`);

      } catch (error) {
        bot.sendMessage(chatId, "❌ Не удалось получить баланс. Пожалуйста, попробуйте авторизоваться заново.");
      }
      break;

    case '💳 Пополнить':
      const user = await User.findOne({ telegramId: chatId });
      if (!user) {
        bot.sendMessage(chatId, "Сначала нужно авторизоваться. Нажмите '🔑 Авторизация'.");
        return;
      }
      userStates[chatId] = { step: 'awaiting_amount' };
      bot.sendMessage(chatId, "Введите сумму для пополнения в рублях (например, 100):");
      break;
  }
});


await connectDB();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log('Бот запущен...');
});