'use client';

import { useCallback } from 'react';
import { getSupabase } from './supabase';

export interface EdgeCallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

export interface EdgeCallError extends Error {
  status: number;
}

/**
 * Calls a Supabase edge function with the current user's access token.
 * Throws EdgeCallError with a safe message on any failure.
 */
export function useEdgeFunction() {
  return useCallback(async <T,>(slug: string, options: EdgeCallOptions = {}): Promise<T> => {
    const supabase = getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${slug}`,
      {
        method: options.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      }
    );

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error: unknown }).error === 'string'
          ? (payload as { error: string }).error
          : `Request failed (${response.status})`;
      const err = new Error(message) as EdgeCallError;
      err.status = response.status;
      throw err;
    }

    return payload as T;
  }, []);
}
