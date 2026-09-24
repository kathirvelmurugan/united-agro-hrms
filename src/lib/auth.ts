const STORAGE_KEY = 'ua_session_user';

export function getToken(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return '';
    return JSON.parse(raw).token || '';
  } catch {
    return '';
  }
}

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers }).then((response) => {
    if (response.status === 401 && !url.endsWith('/api/login')) {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event('ua-auth-expired'));
    }
    return response;
  });
}
