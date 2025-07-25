import axios from 'axios';
import config from '../config/index.js';
import User from '../models/user.model.js';

// --- GraphQL Запросы ---
const LOGIN_MUTATION = `mutation($input: ClientLoginInput!) { clientLogin(input: $input) { access_token, refresh_token } }`;
const REFRESH_TOKEN_MUTATION = `mutation($refreshToken: String!) { clientRefresh(refreshToken: $refreshToken) { access_token, refresh_token } }`;
const MY_CLUB_QUERY = `
query myClub($id: Int!) {
  myClub(id: $id) {
    deposit
    user_bonus
    discount
    hours
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

const AUTH_ERROR_KEYWORDS = ['unauthenticated', 'not permitted', 'token expired'];

async function makeAuthenticatedApiCall(chatId, query, variables) {
  const user = await User.findOne({ telegramId: chatId });
  if (!user) throw new Error("Пользователь не найден. Пожалуйста, авторизуйтесь.");

  try {
    const response = await axios.post(config.smartshellApiUrl, { query, variables }, {
      headers: { 'Authorization': `Bearer ${user.accessToken}` }
    });
    if (response.data.errors) throw new Error(response.data.errors[0].message);
    return response.data.data;
  } catch (error) {
    // Проверяем, содержит ли сообщение об ошибке одно из ключевых слов
    const errorMessage = error.message.toLowerCase();
    const isAuthError = AUTH_ERROR_KEYWORDS.some(keyword => errorMessage.includes(keyword));

    if (isAuthError) {
      console.log(`Authorization error detected for user ${chatId} (message: "${error.message}"). Refreshing token...`);
      try {
        const refreshResponse = await axios.post(config.smartshellApiUrl, {
          query: REFRESH_TOKEN_MUTATION,
          variables: { refreshToken: user.refreshToken }
        });
        if (refreshResponse.data.errors) {
          console.error(`Refresh token failed for user ${chatId}:`, refreshResponse.data.errors[0].message);
          // Если даже refresh token не сработал, удаляем его, чтобы избежать зацикливания
          await User.updateOne({ telegramId: chatId }, { $unset: { accessToken: "", refreshToken: "" } });
          throw new Error("Ваша сессия истекла. Пожалуйста, авторизуйтесь заново.");
        }

        const { access_token: newAccessToken, refresh_token: newRefreshToken } = refreshResponse.data.data.clientRefresh;
        await User.updateOne({ telegramId: chatId }, { accessToken: newAccessToken, refreshToken: newRefreshToken });
        console.log(`Tokens refreshed for user ${chatId}.`);

        const retryResponse = await axios.post(config.smartshellApiUrl, { query, variables }, {
          headers: { 'Authorization': `Bearer ${newAccessToken}` }
        });
        if (retryResponse.data.errors) throw new Error(retryResponse.data.errors[0].message);
        return retryResponse.data.data;
      } catch (refreshError) {
        throw refreshError;
      }
    } else {
      // Если это другая, не связанная с авторизацией ошибка, пробрасываем ее
      throw error;
    }
  }
}

export async function login(login, password) {
  const response = await axios.post(config.smartshellApiUrl, {
    query: LOGIN_MUTATION,
    variables: { input: { login, password } }
  });
  if (response.data.errors) {
    throw new Error(response.data.errors[0].message);
  }
  return response.data.data.clientLogin;
}

export async function getBalance(chatId) {
  const data = await makeAuthenticatedApiCall(chatId, MY_CLUB_QUERY, { id: config.clubId });
  return data.myClub;
}
/**
 * Создает ссылку на оплату
 * @param {number} chatId ID чата пользователя
 * @param {number} amount Сумма пополнения
 * @param {string} botUsername Имя пользователя бота для URL возврата
 * @returns {Promise<string>} Платежная ссылка
 */
export async function createPayment(chatId, amount, botUsername) {
  const variables = {
    input: {
      company_id: config.clubId,
      service: "SBP",
      amount: amount,
      return_format: "LINK",
      success_url: `https://t.me/${botUsername}`,
      fail_url: `https://t.me/${botUsername}`,
    }
  };
  const data = await makeAuthenticatedApiCall(chatId, CREATE_PAYMENT_MUTATION, variables);
  return data.createPaymentTransaction.additional.data;
}