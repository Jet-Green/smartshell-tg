export const mainMenuKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "💰 Баланс" }, { text: "💳 Пополнить" }],
      [{ text: "🔑 Авторизация" }]
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