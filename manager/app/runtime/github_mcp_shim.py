"""Shared Node.js launcher/preload scripts adapting GitHub MCP for GHES custom domains and intranet TLS."""

from __future__ import annotations

GITHUB_MCP_PRELOAD_JS = r"""'use strict';
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

function resolveTargetConfig() {
  let fileCfg = {};
  try {
    const p = '/home/workspace/.dsh-sandbox/github-enterprise.json';
    if (fs.existsSync(p)) {
      fileCfg = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    }
  } catch {}
  let raw = (process.env.METIS_GITHUB_API_URL || process.env.GITHUB_API_URL || '').trim();
  if (!raw && process.env.GITHUB_HOST) {
    let h = String(process.env.GITHUB_HOST).trim().replace(/\/+$/, '');
    if (h && !/^https?:\/\//.test(h)) h = 'https://' + h;
    if (h) {
      const hostOnly = h.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
      if (hostOnly === 'github.com' || hostOnly === 'api.github.com') raw = 'https://api.github.com';
      else if (hostOnly.endsWith('.ghe.com') && !hostOnly.startsWith('api.')) raw = 'https://api.' + hostOnly;
      else raw = h + '/api/v3';
    }
  }
  if (!raw && fileCfg.apiBaseUrl) raw = String(fileCfg.apiBaseUrl).trim();
  raw = (raw || 'https://api.github.com').replace(/\/+$/, '');

  let tlsVerify = true;
  if (process.env.METIS_GITHUB_TLS_VERIFY === '0' || process.env.GITHUB_TLS_VERIFY === '0' || process.env.GITHUB_TLS_VERIFY === 'false') {
    tlsVerify = false;
  } else if (fileCfg.tlsVerify === false) {
    tlsVerify = false;
  }
  return { apiBase: raw, tlsVerify };
}

const cfg = resolveTargetConfig();
if (cfg.apiBase && cfg.apiBase !== 'https://api.github.com' && typeof globalThis.fetch === 'function') {
  const origFetch = globalThis.fetch.bind(globalThis);
  const apiUrlObj = new URL(cfg.apiBase);
  const targetOrigin = apiUrlObj.origin;
  const graphqlUrl = cfg.apiBase.endsWith('/api/v3')
    ? targetOrigin + '/api/graphql'
    : cfg.apiBase + '/graphql';

  function rewriteGithubUrl(rawUrl) {
    if (!rawUrl || !rawUrl.startsWith('https://api.github.com')) return rawUrl;
    const rest = rawUrl.slice('https://api.github.com'.length);
    if (rest && !rest.startsWith('/') && !rest.startsWith('?')) return rawUrl;
    if (rest === '/graphql' || rest.startsWith('/graphql?')) {
      return graphqlUrl + rest.slice('/graphql'.length);
    }
    return cfg.apiBase + rest;
  }

  async function nodeHttpFetch(urlStr, reqMethod, hdrObj, bodyBuf) {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    return await new Promise((resolve, reject) => {
      const req = mod.request(
        u,
        {
          method: reqMethod || 'GET',
          headers: hdrObj,
          rejectUnauthorized: cfg.tlsVerify,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            const h = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (Array.isArray(v)) h.set(k, v.join(', '));
              else if (v !== undefined) h.set(k, String(v));
            }
            const status = res.statusCode || 200;
            const emptyBody = status === 204 || status === 205 || status === 304 || reqMethod === 'HEAD';
            resolve(new Response(emptyBody ? null : buf, { status, statusText: res.statusMessage || '', headers: h }));
          });
        },
      );
      req.on('error', reject);
      if (bodyBuf && bodyBuf.length > 0) req.write(bodyBuf);
      req.end();
    });
  }

  globalThis.fetch = async function patchedGithubFetch(input, init) {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input && typeof input.url === 'string'
          ? input.url
          : '';
    const nextUrl = rewriteGithubUrl(rawUrl);

    if (!cfg.tlsVerify && nextUrl.startsWith(targetOrigin)) {
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const method = (init && init.method) || (isReq ? input.method : 'GET');
      const hdrs = new Headers(isReq ? input.headers : undefined);
      if (init && init.headers) {
        new Headers(init.headers).forEach((v, k) => hdrs.set(k, v));
      }
      const hdrObj = {};
      hdrs.forEach((v, k) => { hdrObj[k] = v; });
      let bodyBuf = null;
      if (init && init.body !== undefined && init.body !== null) {
        if (typeof init.body === 'string' || Buffer.isBuffer(init.body)) bodyBuf = Buffer.from(init.body);
        else bodyBuf = Buffer.from(await new Response(init.body).arrayBuffer());
      } else if (isReq && input.body) {
        bodyBuf = Buffer.from(await input.clone().arrayBuffer());
      }
      return await nodeHttpFetch(nextUrl, method, hdrObj, bodyBuf);
    }

    if (nextUrl !== rawUrl) {
      if (typeof input === 'string' || input instanceof URL) {
        return origFetch(nextUrl, init);
      }
      if (typeof Request !== 'undefined' && input instanceof Request) {
        const cloned = new Request(nextUrl, input);
        return origFetch(cloned, init);
      }
    }
    return origFetch(input, init);
  };
}
"""

GITHUB_MCP_LAUNCHER_JS = r"""'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sbxDir = '/home/workspace/.dsh-sandbox';
const preloadPath = path.join(sbxDir, 'github-mcp-preload.cjs');

let enterpriseCfg = {};
try {
  const cfgPath = path.join(sbxDir, 'github-enterprise.json');
  if (fs.existsSync(cfgPath)) {
    enterpriseCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {};
  }
} catch {}

let apiBase = (process.env.GITHUB_API_URL || '').trim();
if (!apiBase && process.env.GITHUB_HOST) {
  let h = String(process.env.GITHUB_HOST).trim().replace(/\/+$/, '');
  if (h && !/^https?:\/\//.test(h)) h = 'https://' + h;
  if (h) {
    const hostOnly = h.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    if (hostOnly === 'github.com' || hostOnly === 'api.github.com') apiBase = 'https://api.github.com';
    else if (hostOnly.endsWith('.ghe.com') && !hostOnly.startsWith('api.')) apiBase = 'https://api.' + hostOnly;
    else apiBase = h + '/api/v3';
  }
}
if (!apiBase && enterpriseCfg.apiBaseUrl) {
  apiBase = String(enterpriseCfg.apiBaseUrl).trim();
}
apiBase = (apiBase || 'https://api.github.com').replace(/\/+$/, '');

let tlsVerify = '1';
if (process.env.GITHUB_TLS_VERIFY === '0' || process.env.GITHUB_TLS_VERIFY === 'false' || enterpriseCfg.tlsVerify === false) {
  tlsVerify = '0';
}

const existingOpts = (process.env.NODE_OPTIONS || '').trim();
const reqFlag = '--require=' + preloadPath;
const nextNodeOpts = existingOpts.includes(reqFlag)
  ? existingOpts
  : [existingOpts, reqFlag].filter(Boolean).join(' ');

const childEnv = {
  ...process.env,
  METIS_GITHUB_API_URL: apiBase,
  METIS_GITHUB_TLS_VERIFY: tlsVerify,
  NODE_OPTIONS: nextNodeOpts,
};

const child = spawn('npx', ['-y', '@modelcontextprotocol/server-github', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: childEnv,
});
child.on('error', (err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code === null ? 0 : code);
});
"""
