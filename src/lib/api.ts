const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function request<T>(
  path: string,
  options: RequestInit = {},
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  return request<T>(path, { method: 'GET' }, params);
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function patch<T>(path: string, body: unknown, params?: Record<string, string>): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }, params);
}

export async function del(path: string, params?: Record<string, string>): Promise<void> {
  return request<void>(path, { method: 'DELETE' }, params);
}
