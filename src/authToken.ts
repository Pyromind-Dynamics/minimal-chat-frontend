export const DEBUG_USER_ID_HEADER = 'X-Pyromind-Debug-User-Id';
export const DEBUG_USER_NAME_HEADER = 'X-Pyromind-Debug-User-Name';
export const DEBUG_USER_ID_QUERY_PARAM = 'pyromind-debug-user-id';
export const DEBUG_USER_NAME_QUERY_PARAM = 'pyromind-debug-user-name';

export function getDebugUserName(userId: string): string {
  return `debug-user-${userId.trim()}`;
}

export function getDebugAuthHeaders(userId?: string): Record<string, string> {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) {
    return {};
  }

  return {
    [DEBUG_USER_ID_HEADER]: normalizedUserId,
    [DEBUG_USER_NAME_HEADER]: getDebugUserName(normalizedUserId),
  };
}
