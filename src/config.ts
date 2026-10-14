import type { GraphStoreConfig } from './contracts.js';

export const DEFAULT_GRAPH_URL = 'redis://127.0.0.1:6379';
export const DEFAULT_GRAPH_NAME = 'release_memory';

export function readConfig(env: NodeJS.ProcessEnv = process.env): GraphStoreConfig {
  const url = env.FALKORDB_URL ?? DEFAULT_GRAPH_URL;
  const graphName = env.FALKORDB_GRAPH ?? DEFAULT_GRAPH_NAME;
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '6379' || parsed.username || parsed.password) {
    throw new Error('FALKORDB_URL must target the local 127.0.0.1:6379 graph service');
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(graphName)) throw new Error('FALKORDB_GRAPH is invalid');
  return { url, graphName, timeoutMs: 2000 };
}
