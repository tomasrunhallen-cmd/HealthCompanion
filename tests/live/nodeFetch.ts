// Shared by the live checks: jest-expo replaces the global fetch with a mock, so they post with Node's own http.
import * as http from 'http';
import * as https from 'https';
import type { FetchLike } from '../../src/adapter/http';

export const nodeFetch: FetchLike = (url, init) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? https : http).request(u, { method: init.method, headers: init.headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (text += c));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, text: async () => text });
      });
    });
    req.on('error', reject);
    init.signal?.addEventListener('abort', () => req.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    req.end(init.body);
  });

