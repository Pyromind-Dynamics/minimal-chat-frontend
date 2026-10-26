export function formatApiError(status: number, body: string): string {
  let message = body;
  try {
    const { detail } = JSON.parse(body) as { detail?: unknown };
    if (typeof detail === 'string') {
      message = detail;
    } else if (Array.isArray(detail)) {
      message = detail.map((item) => typeof item?.msg === 'string' ? item.msg : '')
        .filter(Boolean).join('; ') || '请求校验失败';
    } else if (detail && typeof detail === 'object') {
      const code = 'code' in detail && typeof detail.code === 'string' ? detail.code : '';
      const reason = 'message' in detail && typeof detail.message === 'string' ? detail.message : '';
      message = [code, reason].filter(Boolean).join(': ') || '请求失败';
    }
  } catch {
    // A proxy may return plain text or HTML instead of the API error envelope.
  }
  return `Request failed: ${status} ${message.slice(0, 1000)}`;
}
