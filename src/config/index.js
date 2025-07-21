// src/config/index.js
import 'dotenv/config';

// Проверка на наличие критически важных переменных
if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.SMARTSHELL_API_URL || !process.env.REQUIRED_CHANNEL_ID || !process.env.SUBSCRIBE_URL) {
  console.error("КРИТИЧЕСКАЯ ОШИБКА: Одна или несколько обязательных переменных окружения не установлены!");
  process.exit(1); // Завершаем работу, если нет конфигурации
}

export default {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  smartshellApiUrl: process.env.SMARTSHELL_API_URL,
  clubId: parseInt(process.env.CLUB_ID, 10),
  requiredChannelId: process.env.REQUIRED_CHANNEL_ID,
  subscribeUrl: process.env.SUBSCRIBE_URL,
  port: process.env.PORT || 3000,
};