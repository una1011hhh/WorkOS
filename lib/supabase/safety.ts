export const SUPABASE_QUERY_TIMEOUT_MS = 4_000;
export const SUPABASE_WRITE_TIMEOUT_MS = 5_000;
export const SUPABASE_AUTH_TIMEOUT_MS = 3_000;
export const SUPABASE_FETCH_TIMEOUT_MS = 4_500;

export const SUPABASE_ROW_LIMITS = {
  projects: 200,
  tasks: 500,
  time_sessions: 1_000,
  meetings: 300,
  meeting_action_items: 700,
  reflections: 200,
  reports: 100,
  contacts: 500,
  contact_groups: 200,
} as const;

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function chunkRows<T>(rows: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
