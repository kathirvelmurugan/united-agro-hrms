const STORAGE_KEY = 'ua_session_user';

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...options, credentials: 'same-origin' }).then((response) => {
    if (response.status === 401 && !url.endsWith('/api/login')) {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event('ua-auth-expired'));
    }
    return response;
  });
}
