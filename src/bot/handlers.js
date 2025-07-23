import User from '../models/user.model.js';
import * as keyboards from './keyboards.js';
import * as smartshell from '../api/smartshell.service.js';
import * as subscription from '../services/subscription.service.js';
import config from '../config/index.js';

// Внутреннее хранилище состояний
const userStates = {};

/**
 * Отправляет сообщение с запросом на согласие обработки персональных данных.
 * @param {TelegramBot} bot 
 * @param {number} chatId 
 */
function requestPrivacyAgreement(bot, chatId) {
  const text = "👋 Добро пожаловать!\n\nДля продолжения работы с ботом необходимо ваше согласие на обработку персональных данных в соответствии с нашей политикой конфиденциальности.";
  bot.sendMessage(chatId, text, {
    reply_markup: keyboards.getAgreementKeyboard(config.privacyPolicyUrl)
  });
}

/**
 * Вспомогательная функция для начала процесса авторизации.
 * @param {TelegramBot} bot 
 * @param {number} chatId 
 */
function startLoginProcess(bot, chatId) {
  userStates[chatId] = { step: 'awaiting_login' };
  bot.sendMessage(chatId, 'Пожалуйста, введите ваш логин от Smartshell (телефон, без "+" в начале).', keyboards.cancelKeyboard);
}

/**
 * Приветствует пользователя и показывает правильную клавиатуру.
 * @param {TelegramBot} bot 
 * @param {number} chatId 
 */
async function sendWelcomeMessage(bot, chatId) {
  const user = await User.findOne({ telegramId: chatId });
  const welcomeText = `👋 Добро пожаловать! Используйте меню для навигации.`;
  const keyboard = user ? keyboards.authorizedKeyboard : keyboards.unauthorizedKeyboard;
  bot.sendMessage(chatId, welcomeText, keyboard);
}


/**
 * Регистрирует все обработчики событий для бота.
 * @param {TelegramBot} bot Экземпляр бота
 */
export function registerHandlers(bot) {

  bot.onText(/\/start/, async (msg) => {
    const { id: chatId } = msg.chat;
    userStates[chatId] = { awaitingPrivacy: true };
    requestPrivacyAgreement(bot, chatId);
  });


  bot.onText(/\/login/, async (msg) => {
    const { id: chatId } = msg.chat;
    if (userStates[chatId]?.awaitingPrivacy) {
      requestPrivacyAgreement(bot, chatId);
      return;
    }
    startLoginProcess(bot, chatId);
  });

  bot.on('callback_query', async (callbackQuery) => {
    const { data, message, from } = callbackQuery;
    const { id: chatId } = message.chat;
    const { id: userId } = from;

    await bot.answerCallbackQuery(callbackQuery.id);

    switch (data) {
      case 'agree_privacy':
        delete userStates[chatId];
        await bot.deleteMessage(chatId, message.message_id);

        // После согласия сразу проверяем подписку
        if (!(await subscription.isUserSubscribed(bot, userId))) {
          subscription.sendSubscriptionMessage(bot, chatId);
        } else {
          // Если уже подписан, сразу приветствуем
          await bot.sendMessage(chatId, "Спасибо за ваше согласие!");
          await sendWelcomeMessage(bot, chatId);
        }
        break;

      case 'disagree_privacy':
        await bot.editMessageText("К сожалению, без вашего согласия бот не может функционировать. Если вы передумаете, просто отправьте команду /start.", {
          chat_id: chatId,
          message_id: message.message_id
        });
        break;

      case 'check_subscription':
        if (await subscription.isUserSubscribed(bot, userId)) {
          await bot.deleteMessage(chatId, message.message_id);
          await sendWelcomeMessage(bot, chatId);
        } else {
          await bot.sendMessage(chatId, "Подписка не найдена. Пожалуйста, подпишитесь и попробуйте снова.");
        }
        break;
    }
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const { id: chatId } = msg.chat;
    const { text, from } = msg;

    // 1. Блокировка до согласия
    if (userStates[chatId]?.awaitingPrivacy) {
      requestPrivacyAgreement(bot, chatId);
      return;
    }

    // 2. Обработка отмены
    if (text === 'Отмена') {
      delete userStates[chatId];
      const user = await User.findOne({ telegramId: chatId });
      const keyboard = user ? keyboards.authorizedKeyboard : keyboards.unauthorizedKeyboard;
      bot.sendMessage(chatId, "Действие отменено.", keyboard);
      return;
    }

    // 3. Обработка шагов (ввод данных)
    const currentState = userStates[chatId];
    if (currentState?.step) {
      await handleStatefulMessage(bot, msg, currentState);
      return;
    }

    // 4. Проверка подписки (если пользователь пытается что-то написать, не нажав "Я подписался")
    if (!(await subscription.isUserSubscribed(bot, from.id))) {
      subscription.sendSubscriptionMessage(bot, chatId);
      return;
    }

    // 5. Обработка команд из меню
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

    if (isNaN(amount) || amount <= 0 || amount < 10) {
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
      await bot.sendMessage(chatId, "Вы можете продолжить пользование.", keyboards.authorizedKeyboard);
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
      try {
        const user = await User.findOne({ telegramId: chatId });
        if (!user || !user.accessToken) {
          bot.sendMessage(chatId, "Сначала нужно авторизоваться. Нажмите '🔑 Авторизация'.");
          return;
        }

        bot.sendMessage(chatId, "Запрашиваю информацию о вашем профиле...");
        const data = await callSmartshellAPI(MY_CLUB_QUERY, { id: user.clubId }, user.accessToken);

        // Получаем все нужные поля из ответа
        const { deposit, user_bonus, discount, hours } = data.myClub;

        // Формируем красивое сообщение со всей информацией
        const profileInfo = `
              ℹ️ **Ваш профиль в клубе**

              **Финансы:**
              ▫️ Депозит: *${deposit} руб.*
              ▫️ Бонусы: *${user_bonus} руб.*

              **Статус:**
              ▫️ Ваша скидка: *${discount}%*
              ▫️ Пакетное время: *${hours} ч.*
                `;

        bot.sendMessage(chatId, profileInfo, { parse_mode: 'Markdown' });

      } catch (error) {
        bot.sendMessage(chatId, "❌ Не удалось получить данные профиля.\nПопробуйте команду /login, чтобы зайти снова.");
      }
      break;


    // await bot.sendChatAction(chatId, 'typing');
    // try {
    //   const { deposit, user_bonus } = await smartshell.getBalance(chatId);
    //   bot.sendMessage(chatId, `ℹ️ Ваш баланс:\n\n▫️ Депозит: ${deposit} руб.\n▫️ Бонусы: ${user_bonus} руб.`);
    // } catch (error) {
    //   bot.sendMessage(chatId, `❌ Не удалось получить баланс. ${error.message}\nПопробуйте команду /login, чтобы зайти снова.`, keyboards.authorizedKeyboard);
    // }
    // break;

    case '💳 Пополнить':
      userStates[chatId] = { step: 'awaiting_amount' };
      bot.sendMessage(chatId, "Введите сумму для пополнения (от 10 руб.):", keyboards.cancelKeyboard);
      break;
  }
}