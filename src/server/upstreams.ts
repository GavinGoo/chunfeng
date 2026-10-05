import { getConfig } from './config';
import { mockJevFetch } from './jev/mock';
import { mockLlmFetch } from './llm/mock';

// Mock 注入点（01 §10.5）：MOCK_UPSTREAMS=true 时，LLM/JEV 客户端使用模拟的 fetch。
export function upstreamFetch(source: 'llm' | 'jev'): typeof fetch {
  if (!getConfig().mock.enabled) return fetch;
  return source === 'llm' ? mockLlmFetch : mockJevFetch;
}
