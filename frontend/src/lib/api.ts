export function getApiAuthHeaders(): Record<string, string> {
  const apiKey = localStorage.getItem('ragussy_api_key')?.trim();
  if (!apiKey) {
    return {};
  }

  return {
    'x-api-key': apiKey,
  };
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const authHeaders = getApiAuthHeaders();

  for (const [key, value] of Object.entries(authHeaders)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return fetch(input, {
    ...init,
    headers,
  });
}
