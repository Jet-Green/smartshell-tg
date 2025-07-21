import User from '../models/user.model.js';
import * as keyboards from './keyboards.js';
import * as smartshell from '../api/smartshell.service.js';
import * as subscription from '../services/subscription.service.js';
import config from '../config/index.js';

// Внутреннее хранилище состояний
const userStates = {};

/**
 * Вспомогательная функция для начала процесса авторизации.
 * @param {TelegramBot} bot 
 * @param {number} chatId 
 */
function startLoginProcess(bot, chatId) {
  userStates[chatId] = { step: 'awaiting_login' };
  bot.sendMessage(chatId, "Пожалуйста, введите ваш логин от Smartshell (телефон).", keyboards.cancelKeyboard);
}

/**
 * Регистрирует все обработчики событий для бота.
 * @param {TelegramBot} bot Экземпляр бота
 */
export function registerHandlers(bot) {

  bot.onText(/\/start/, async (msg) => {
    const { id: chatId } = msg.chat;
    delete userStates[chatId];

    if (!(await subscription.isUserSubscribed(bot, msg.from.id))) {
      subscription.sendSubscriptionMessage(bot, chatId);
      return;
    }

    const user = await User.findOne({ telegramId: chatId });
    const welcomeText = `👋 Добро пожаловать!`;
    const keyboard = user ? keyboards.authorizedKeyboard : keyboards.unauthorizedKeyboard;

    bot.sendMessage(chatId, welcomeText, keyboard);
  });


  bot.onText(/\/login/, async (msg) => {
    const { id: chatId } = msg.chat;
    startLoginProcess(bot, chatId);
  });

  bot.on('callback_query', async (callbackQuery) => {
    const { data, message } = callbackQuery;
    const { id: chatId } = message.chat;

    if (data === 'check_subscription') {
      await bot.answerCallbackQuery(callbackQuery.id);
      if (await subscription.isUserSubscribed(bot, callbackQuery.from.id)) {
        await bot.deleteMessage(chatId, message.message_id);
        // После подписки сразу показываем правильную клавиатуру
        const user = await User.findOne({ telegramId: chatId });
        const keyboard = user ? keyboards.authorizedKeyboard : keyboards.unauthorizedKeyboard;
        await bot.sendMessage(chatId, "Спасибо за подписку! Теперь вы можете пользоваться ботом.", keyboard);
      } else {
        await bot.sendMessage(chatId, "Подписка не найдена. Пожалуйста, подпишитесь и попробуйте снова.");
      }
    }
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const { id: chatId } = msg.chat;
    const { text } = msg;

    // 1. Обработка отмены
    if (text === 'Отмена') {
      delete userStates[chatId];
      const user = await User.findOne({ telegramId: chatId });
      const keyboard = user ? keyboards.authorizedKeyboard : keyboards.unauthorizedKeyboard;
      bot.sendMessage(chatId, "Действие отменено.", keyboard);
      return;
    }

    // 2. Обработка шагов (ввод данных)
    const currentState = userStates[chatId];
    if (currentState) {
      await handleStatefulMessage(bot, msg, currentState);
      return;
    }

    // 3. Проверка подписки перед выполнением команд
    if (!(await subscription.isUserSubscribed(bot, msg.from.id))) {
      subscription.sendSubscriptionMessage(bot, chatId);
      return;
    }

    // 4. Обработка команд из главного меню
    await handleMenuCommand(bot, msg);
  });
}

async function handleStatefulMessage(bot, msg, state) {
  const { id: chatId } = msg.chat;
  const { text } = msg;

  if (state.step === 'awaiting_login') {
    state.login = text;
    state.step = 'awaiting_password';
    bot.sendMessage(chatId, "Отлично, теперь введите ваш пароль.", keyboards.cancelKeyboard);
  } else if (state.step === 'awaiting_password') {
    const { login } = state;
    delete userStates[chatId];

    await bot.sendMessage(chatId, "Проверяю данные...", keyboards.removeKeyboard);
    try {
      const { access_token, refresh_token } = await smartshell.login(login, text);
      await User.findOneAndUpdate({ telegramId: chatId }, {
        telegramId: chatId,
        firstName: msg.from.first_name,
        smartshellLogin: login,
        accessToken: access_token,
        refreshToken: refresh_token,
        clubId: config.clubId,
      }, { upsert: true, new: true });
      // После успешной авторизации показываем клавиатуру для авторизованных
      await bot.sendMessage(chatId, "✅ Авторизация прошла успешно!", keyboards.authorizedKeyboard);
    } catch (error) {
      // Если ошибка, показываем клавиатуру для неавторизованных
      await bot.sendMessage(chatId, `❌ Ошибка авторизации: ${error.message}`, keyboards.unauthorizedKeyboard);
    }
  } else if (state.step === 'awaiting_amount') {
    const amount = parseInt(text, 10);
    delete userStates[chatId];

    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, "❌ Некорректная сумма.", keyboards.authorizedKeyboard);
      return;
    }

    await bot.sendMessage(chatId, "Генерирую ссылку на оплату...", keyboards.removeKeyboard);
    await bot.sendChatAction(chatId, 'typing');

    try {
      const botUsername = (await bot.getMe()).username;
      const paymentLink = await smartshell.createPayment(chatId, amount, botUsername);

      await bot.sendMessage(chatId, "Ваша ссылка для пополнения баланса:", {
        reply_markup: { inline_keyboard: [[{ text: `Оплатить ${amount} руб.`, url: paymentLink }]] }
      });
      await bot.sendMessage(chatId, "Используйте меню для других действий.", keyboards.authorizedKeyboard);
    } catch (error) {
      await bot.sendMessage(chatId, `❌ Не удалось создать ссылку. ${error.message}\nПопробуйте команду /login, чтобы зайти снова.`, keyboards.authorizedKeyboard);
    }
  }
}

async function handleMenuCommand(bot, msg) {
  const { id: chatId } = msg.chat;
  const { text } = msg;

  const user = await User.findOne({ telegramId: chatId });

  // Если пользователь не авторизован, он может нажать только "Авторизация"
  if (!user) {
    if (text === '🔑 Авторизация') {
      startLoginProcess(bot, chatId);
    } else {
      // Защита от случайных сообщений, когда пользователь не авторизован
      bot.sendMessage(chatId, "Пожалуйста, сначала авторизуйтесь.", keyboards.unauthorizedKeyboard);
    }
    return;
  }

  // Если пользователь авторизован, обрабатываем его команды
  switch (text) {
    case '💰 Баланс':
      await bot.sendChatAction(chatId, 'typing');
      try {
        const { deposit, user_bonus } = await smartshell.getBalance(chatId);
        bot.sendMessage(chatId, `ℹ️ Ваш баланс:\n\n▫️ Депозит: ${deposit} руб.\n▫️ Бонусы: ${user_bonus} руб.`);
      } catch (error) {
        bot.sendMessage(chatId, `❌ Не удалось получить баланс. ${error.message}\nПопробуйте команду /login, чтобы зайти снова.`, keyboards.authorizedKeyboard);
      }
      break;

    case '💳 Пополнить':
      userStates[chatId] = { step: 'awaiting_amount' };
      bot.sendMessage(chatId, "Введите сумму для пополнения в рублях:", keyboards.cancelKeyboard);
      break;
  }
}