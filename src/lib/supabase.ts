const API_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

export type OrderDir = 'asc' | 'desc';

export interface QueryOptions {
  filters?: Record<string, string>;
  order?: { column: string; dir?: OrderDir };
  limit?: number;
}

function buildUrl(table: string, opts?: QueryOptions, id?: string): string {
  const base = `${API_URL}/${table}`;
  const params = new URLSearchParams();

  if (opts?.filters) {
    Object.entries(opts.filters).forEach(([k, v]) => params.set(k, v));
  }
  if (opts?.order) {
    params.set('order', `${opts.order.column}.${opts.order.dir ?? 'asc'}`);
  }
  if (opts?.limit) {
    params.set('limit', String(opts.limit));
  }

  const qs = params.toString();
  const path = id ? `${base}?id=eq.${id}${qs ? '&' + qs : ''}` : qs ? `${base}?${qs}` : base;
  return path;
}

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Prefer: 'return=representation',
    ...extra,
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...headers(), ...(init?.headers as Record<string, string> || {}) } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.message || body.details || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  if (res.status === 204) return [] as unknown as T;
  return res.json() as Promise<T>;
}

export const db = {
  select: <T>(table: string, opts?: QueryOptions): Promise<T[]> =>
    request<T[]>(buildUrl(table, opts)),

  selectOne: <T>(table: string, id: string): Promise<T | null> =>
    request<T[]>(buildUrl(table, undefined, id)).then(rows => (rows[0] ?? null)),

  insert: <T>(table: string, data: unknown): Promise<T> =>
    request<T[]>(buildUrl(table), {
      method: 'POST',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(data),
    }).then(rows => (Array.isArray(rows) ? rows[0] : rows) as T),

  update: <T>(table: string, id: string, data: unknown): Promise<T> =>
    request<T[]>(`${API_URL}/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(data),
    }).then(rows => (Array.isArray(rows) ? rows[0] : rows) as T),

  updateWhere: <T>(table: string, filter: Record<string, string>, data: unknown): Promise<T> => {
    const params = new URLSearchParams(filter).toString();
    return request<T[]>(`${API_URL}/${table}?${params}`, {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(data),
    }).then(rows => (Array.isArray(rows) ? rows[0] : rows) as T);
  },

  delete: (table: string, id: string): Promise<void> =>
    request<void>(`${API_URL}/${table}?id=eq.${id}`, { method: 'DELETE' }),
};
