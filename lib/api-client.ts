/**
 * Typed API client using ts-rest contract types.
 * Uses fetch under the hood for Next.js App Router compatibility.
 */
import type { CallLog, ListEntry, Message, AppSettings } from './contract';

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  return res.json() as Promise<T>;
}

function jsonBody(body: unknown): RequestInit {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const apiClient = {
  calls: {
    list: (query: { limit?: number; offset?: number; search?: string; startDate?: string; endDate?: string }) => {
      const params = new URLSearchParams();
      if (query.limit   != null) params.set('limit',     String(query.limit));
      if (query.offset  != null) params.set('offset',    String(query.offset));
      if (query.search)          params.set('search',    query.search);
      if (query.startDate)       params.set('startDate', query.startDate);
      if (query.endDate)         params.set('endDate',   query.endDate);
      return apiFetch<{ rows: CallLog[]; total: number }>(`/api/calls?${params}`);
    },
    trend: (days: number) =>
      apiFetch<{ date: string; total: number; blocked: number; permitted: number }[]>(`/api/calls/trend?days=${days}`),
    top: () =>
      apiFetch<{ callers: { number: string; name: string | null; count: number }[]; blocked: { number: string; name: string | null; count: number }[] }>('/api/calls/top'),
  },
  whitelist: {
    list: (query: { limit?: number; offset?: number; search?: string } = {}) => {
      const params = new URLSearchParams();
      if (query.limit  != null) params.set('limit',  String(query.limit));
      if (query.offset != null) params.set('offset', String(query.offset));
      if (query.search)         params.set('search', query.search);
      return apiFetch<{ rows: ListEntry[]; total: number }>(`/api/whitelist?${params}`);
    },
    add:    (body: { phoneNo: string; name?: string; reason?: string }) => apiFetch<{ ok: true }>('/api/whitelist', { method: 'POST',   ...jsonBody(body) }),
    remove: (body: { phoneNo: string })                                 => apiFetch<{ ok: true }>('/api/whitelist', { method: 'DELETE', ...jsonBody(body) }),
  },
  blacklist: {
    list: (query: { limit?: number; offset?: number; search?: string } = {}) => {
      const params = new URLSearchParams();
      if (query.limit  != null) params.set('limit',  String(query.limit));
      if (query.offset != null) params.set('offset', String(query.offset));
      if (query.search)         params.set('search', query.search);
      return apiFetch<{ rows: ListEntry[]; total: number }>(`/api/blacklist?${params}`);
    },
    add:    (body: { phoneNo: string; name?: string; reason?: string }) => apiFetch<{ ok: true }>('/api/blacklist', { method: 'POST',   ...jsonBody(body) }),
    remove: (body: { phoneNo: string })                                 => apiFetch<{ ok: true }>('/api/blacklist', { method: 'DELETE', ...jsonBody(body) }),
  },
  messages: {
    list: (query: { limit?: number; offset?: number; search?: string; startDate?: string; endDate?: string; unplayedOnly?: boolean }) => {
      const params = new URLSearchParams();
      if (query.limit   != null)  params.set('limit',        String(query.limit));
      if (query.offset  != null)  params.set('offset',       String(query.offset));
      if (query.search)           params.set('search',       query.search);
      if (query.startDate)        params.set('startDate',    query.startDate);
      if (query.endDate)          params.set('endDate',      query.endDate);
      if (query.unplayedOnly)     params.set('unplayedOnly', 'true');
      return apiFetch<{ messages: Message[]; total: number }>(`/api/messages?${params}`);
    },
    patch:  (body: { messageId: number; played: boolean })  => apiFetch<{ ok: true }>('/api/messages', { method: 'PATCH',  ...jsonBody(body) }),
    delete: (body: { messageId: number })                   => apiFetch<{ ok: true }>('/api/messages', { method: 'DELETE', ...jsonBody(body) }),
    unread: ()                                               => apiFetch<{ count: number }>('/api/messages/unread'),
  },
  settings: {
    get:  ()                                       => apiFetch<AppSettings>('/api/settings'),
    save: (body: Partial<Omit<AppSettings, 'serialPort' | 'serialBaudRate'>>) =>
      apiFetch<{ ok: true }>('/api/settings', { method: 'POST', ...jsonBody(body) }),
  },
};
