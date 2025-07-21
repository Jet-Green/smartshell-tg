import User from '../models/user.model.js';
import * as keyboards from './keyboards.js';
import * as smartshell from '../api/smartshell.service.js';
import * as subscription from '../services/subscription.service.js';
import config from '../config/index.js';

// Внутреннее хранилище состояний
const userStates = {};

/**
 * Регистрирует все обработчики событий для бота.
 * @param {TelegramBot} bot Экземпляр бота
 */
export function registerHandlers(bot) {

  bot.onText(/\/start/, async (msg) => {
    const { id: chatId } = msg.chat;
    delete userStates[chatId]; // Сбрасываем состояние

    if (!(await subscription.isUserSubscribed(bot, msg.from.id))) {
      subscription.sendSubscriptionMessage(bot, chatId);
      return;
    }
    bot.sendMessage(chatId, `👋 Добро пожаловать!`, keyboards.mainMenuKeyboard);
  });

  bot.on('callback_query', async (callbackQuery) => {
    const { data, message } = callbackQuery;
    const { id: chatId } = message.chat;

    if (data === 'check_subscription') {
      await bot.answerCallbackQuery(callbackQuery.id);
      if (await subscription.isUserSubscribed(bot, callbackQuery.from.id)) {
        await bot.deleteMessage(chatId, message.message_id);
        await bot.sendMessage(chatId, "Спасибо за подписку! Теперь вы можете пользоваться ботом.", keyboards.mainMenuKeyboard);
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
      bot.sendMessage(chatId, "Действие отменено.", keyboards.mainMenuKeyboard);
      return;
    }

    // 2. Обработка шагов конечного автомата (ввод данных)
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
      await bot.sendMessage(chatId, "✅ Авторизация прошла успешно!", keyboards.mainMenuKeyboard);
    } catch (error) {
      await bot.sendMessage(chatId, `❌ Ошибка авторизации: ${error.message}`, keyboards.mainMenuKeyboard);
    }
  } else if (state.step === 'awaiting_amount') {
    const amount = parseInt(text, 10);
    delete userStates[chatId]; // Сразу удаляем состояние

    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, "❌ Некорректная сумма. Пожалуйста, введите целое положительное число.", keyboards.mainMenuKeyboard);
      return;
    }

    await bot.sendMessage(chatId, "Генерирую ссылку на оплату...", keyboards.removeKeyboard);
    await bot.sendChatAction(chatId, 'typing');

    try {
      const botUsername = (await bot.getMe()).username;
      const paymentLink = await smartshell.createPayment(chatId, amount, botUsername);

      await bot.sendMessage(chatId, "Ваша ссылка для пополнения баланса:", {
        reply_markup: {
          inline_keyboard: [[{ text: `Оплатить ${amount} руб.`, url: paymentLink }]]
        }
      });
      // Возвращаем основную клавиатуру
      await bot.sendMessage(chatId, "Вы можете продолжить пользование.", keyboards.mainMenuKeyboard);

    } catch (error) {
      await bot.sendMessage(chatId, `❌ Не удалось создать ссылку на оплату. ${error.message}`, keyboards.mainMenuKeyboard);
    }
  }
}

async function handleMenuCommand(bot, msg) {
  const { id: chatId } = msg.chat;
  const { text } = msg;

  switch (text) {
    case '🔑 Авторизация':
      userStates[chatId] = { step: 'awaiting_login' };
      bot.sendMessage(chatId, "Введите ваш логин от Smartshell (телефон).", keyboards.cancelKeyboard);
      break;

    case '💰 Баланс':
      await bot.sendChatAction(chatId, 'typing');
      try {
        const { deposit, user_bonus } = await smartshell.getBalance(chatId);
        bot.sendMessage(chatId, `ℹ️ Ваш баланс:\n\n▫️ Депозит: ${deposit} руб.\n▫️ Бонусы: ${user_bonus} руб.`);
      } catch (error) {
        bot.sendMessage(chatId, `❌ Не удалось получить баланс. ${error.message}`, keyboards.mainMenuKeyboard);
      }
      break;
    case '💳 Пополнить':
      const user = await User.findOne({ telegramId: chatId });
      if (!user) {
        bot.sendMessage(chatId, "Сначала нужно авторизоваться. Нажмите '🔑 Авторизация'.", keyboards.mainMenuKeyboard);
        return;
      }
      userStates[chatId] = { step: 'awaiting_amount' };
      bot.sendMessage(chatId, "Введите сумму для пополнения в рублях (например, 100):", keyboards.cancelKeyboard);
      break;
  }
}