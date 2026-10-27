import axios from 'axios'
import mockApiAdapter from '../mocks/mockApi'

export const TOKEN_STORAGE_KEY = 'fraud-dashboard-token'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
})

if (import.meta.env.VITE_USE_MOCK === 'true') {
  apiClient.defaults.adapter = mockApiAdapter
}

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = 'Bearer ' + token
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY)

      if (window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }

    return Promise.reject(error)
  },
)

export function getApiErrorMessage(error, fallback) {
  if (error?.response?.status === 429) {
    const retryAfter = Number(error.response.headers?.['retry-after'])
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      const unit = retryAfter === 1 ? 'second' : 'seconds'
      return `Too many requests. Please wait ${retryAfter} ${unit}, then try again.`
    }
    return 'Too many requests. Please wait a moment, then try again.'
  }

  const message = error?.response?.data?.error?.message
  return typeof message === 'string' && message ? message : fallback
}

export default apiClient
