import axios from 'axios';
import config from '../config/index.js';
import User from '../models/user.model.js';

// --- GraphQL Запросы ---
const LOGIN_MUTATION = `mutation($input: ClientLoginInput!) { clientLogin(input: $input) { access_token, refresh_token } }`;
const REFRESH_TOKEN_MUTATION = `mutation($refreshToken: String!) { clientRefreshToken(refreshToken: $refreshToken) { access_token, refresh_token } }`;
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

async function makeAuthenticatedApiCall(chatId, query, variables) {
  const user = await User.findOne({ telegramId: chatId });
  if (!user) throw new Error("Пользователь не найден. Пожалуйста, авторизуйтесь.");

  try {
    // Попытка №1: Выполнить запрос с текущим access_token
    const response = await axios.post(config.smartshellApiUrl, { query, variables }, {
      headers: { 'Authorization': `Bearer ${user.accessToken}` }
    });
    // Если GraphQL вернул ошибку в теле ответа при статусе 200
    if (response.data.errors) {
      // Проверяем, не является ли эта ошибка ошибкой авторизации
      const errorMessage = response.data.errors[0].message.toLowerCase();
      if (errorMessage.includes('unauthenticated') || errorMessage.includes('not permitted')) {
        // Если да, то искусственно создаем ошибку, чтобы попасть в блок catch
        throw new Error('GraphQL Unauthenticated');
      } else {
        // Иначе это другая GraphQL-ошибка
        throw new Error(response.data.errors[0].message);
      }
    }
    return response.data.data;
  } catch (error) {
    // Сюда мы попадаем либо из-за ошибки сети/статуса (от axios), либо из-за нашей искусственной ошибки

    // Проверяем, является ли ошибка ошибкой авторизации
    // Это может быть HTTP 401/403 или наша ошибка 'GraphQL Unauthenticated'
    const isAuthError = (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403))
      || error.message === 'GraphQL Unauthenticated';

    if (isAuthError) {
      console.log(`Authorization error detected for user ${chatId}. Refreshing token...`);
      try {
        // Попытка №2: Обновить токен
        const refreshResponse = await axios.post(config.smartshellApiUrl, {
          query: REFRESH_TOKEN_MUTATION,
          variables: { refreshToken: user.refreshToken }
        });

        // Если при обновлении токена возникла ошибка (например, 422 как у вас)
        if (refreshResponse.data.errors) {
          console.error(`Refresh token is invalid for user ${chatId}:`, refreshResponse.data.errors[0].message);
          // Удаляем нерабочие токены, чтобы избежать зацикливания
          await User.updateOne({ telegramId: chatId }, { $unset: { accessToken: "", refreshToken: "" } });
          throw new Error("Ваша сессия истекла. Пожалуйста, авторизуйтесь заново.");
        }

        const { access_token: newAccessToken, refresh_token: newRefreshToken } = refreshResponse.data.data.clientRefresh;
        await User.updateOne({ telegramId: chatId }, { accessToken: newAccessToken, refreshToken: newRefreshToken });
        console.log(`Tokens refreshed successfully for user ${chatId}.`);

        // Попытка №3: Повторить исходный запрос с новым токеном
        const retryResponse = await axios.post(config.smartshellApiUrl, { query, variables }, {
          headers: { 'Authorization': `Bearer ${newAccessToken}` }
        });
        if (retryResponse.data.errors) throw new Error(retryResponse.data.errors[0].message);
        return retryResponse.data.data;

      } catch (refreshError) {
        // Если что-то пошло не так на этапе обновления, пробрасываем финальную ошибку
        // Если это ошибка от axios, пытаемся вытащить более понятное сообщение
        if (axios.isAxiosError(refreshError) && refreshError.response?.data?.errors) {
          throw new Error(`Ошибка обновления сессии: ${refreshError.response.data.errors[0].message}`);
        }
        throw refreshError;
      }
    } else {
      // Если это другая, не связанная с авторизацией ошибка, просто пробрасываем её дальше
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