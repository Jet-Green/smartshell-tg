import config from '../config/index.js';
import { getSubscriptionKeyboard } from '../bot/keyboards.js';

/**
 * Проверяет, подписан ли пользователь на канал.
 * @param {TelegramBot} bot Экземпляр бота
 * @param {number} userId ID пользователя
 * @returns {Promise<boolean>}
 */
export async function isUserSubscribed(bot, userId) {
  try {
    const member = await bot.getChatMember(config.requiredChannelId, userId);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch (error) {
    // Если API возвращает ошибку (например, "user not found"), пользователь не является участником.
    return false;
  }
}

/**
 * Отправляет сообщение с просьбой подписаться.
 * @param {TelegramBot} bot Экземпляр бота
 * @param {number} chatId ID чата
 */
export function sendSubscriptionMessage(bot, chatId) {
  bot.sendMessage(
    chatId,
    "❗️ Для использования бота, пожалуйста, подпишитесь на наш канал.",
    {
      reply_markup: getSubscriptionKeyboard(config.subscribeUrl)
    }
  );
}