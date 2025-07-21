// Клавиатура для АВТОРИЗОВАННЫХ пользователей
export const authorizedKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "💰 Баланс" }, { text: "💳 Пополнить" }],
      // Кнопки "Авторизация" здесь нет, но можно добавить кнопку смены аккаунта
    ],
    resize_keyboard: true,
  },
};

// Клавиатура для НЕАВТОРИЗОВАННЫХ пользователей
export const unauthorizedKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "🔑 Авторизация" }],
    ],
    resize_keyboard: true,
  },
};

export const cancelKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "Отмена" }]
    ],
    resize_keyboard: true,
  },
};

export const removeKeyboard = {
  reply_markup: {
    remove_keyboard: true,
  }
};

export const getSubscriptionKeyboard = (url) => ({
  inline_keyboard: [
    [{ text: "➡️ Подписаться на канал", url }],
    [{ text: "✅ Я подписался", callback_data: "check_subscription" }]
  ]
});