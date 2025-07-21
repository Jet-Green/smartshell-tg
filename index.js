import TelegramBot from 'node-telegram-bot-api';
import connectDB from './db.js';
import config from './src/config/index.js';
import { registerHandlers } from './src/bot/handlers.js';

async function main() {
  // 1. Подключаемся к базе данных
  await connectDB();
  console.log('✅ База данных подключена.');

  // 2. Создаем экземпляр бота
  const bot = new TelegramBot(config.telegramBotToken, { polling: true });

  // 3. Регистрируем все обработчики
  registerHandlers(bot);
}

main().catch(err => {
  console.error('💥 Не удалось запустить бота:', err);
  process.exit(1);
});