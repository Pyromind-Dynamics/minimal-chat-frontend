// Backend configuration
// When using Vite proxy (dev mode), we use relative URLs.
// The proxy in vite.config.ts forwards /api/* and /sockets/* to the agent-server.

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';
export const WS_BASE_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.host}`;
export const SESSION_API_KEY = import.meta.env.VITE_SESSION_API_KEY || '';

// LLM Configuration (passed to agent-server when creating conversations)
export const LLM_MODEL = import.meta.env.VITE_LLM_MODEL || 'gpt-4o';
export const LLM_API_KEY = import.meta.env.VITE_LLM_API_KEY || '';
export const LLM_BASE_URL = import.meta.env.VITE_LLM_BASE_URL || '';
