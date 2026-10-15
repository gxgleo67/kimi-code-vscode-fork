import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { afterEach, describe, expect, it } from 'vitest';

import { McpOAuthService } from '#/mcpCore/oauth/service';

import { createMemoryMcpOAuthStore } from '../stubs';

const SERVER_NAME = 'notion';
const SERVER_URL = 'https://mcp.example.test/mcp';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

interface FakeAuthServer {
  readonly url: string;
  readonly registerScopes: Array<string | undefined>;
}

function registerHttpCleanup(httpServer: HttpServer): void {
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  );
}

async function startFakeAuthServer(): Promise<FakeAuthServer> {
  const registerScopes: Array<string | undefined> = [];
  const httpServer: HttpServer = createHttpServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/register') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf-8');
    });
    req.on('end', () => {
      const metadata = JSON.parse(body) as Record<string, unknown>;
      const scope = metadata['scope'];
      registerScopes.push(typeof scope === 'string' ? scope : undefined);
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...metadata, client_id: `test-client-${String(registerScopes.length)}` }));
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  registerHttpCleanup(httpServer);
  const { port } = httpServer.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}`, registerScopes };
}

function authServerState(
  authServerUrl: string,
  options: {
    readonly scopesSupported?: string[];
    readonly resourceScopesSupported?: string[];
  } = {},
): OAuthDiscoveryState {
  return {
    authorizationServerUrl: authServerUrl,
    authorizationServerMetadata: {
      issuer: authServerUrl,
      authorization_endpoint: `${authServerUrl}/authorize`,
      token_endpoint: `${authServerUrl}/token`,
      registration_endpoint: `${authServerUrl}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: options.scopesSupported,
    },
    resourceMetadata:
      options.resourceScopesSupported === undefined
        ? undefined
        : {
            resource: SERVER_URL,
            authorization_servers: [authServerUrl],
            scopes_supported: options.resourceScopesSupported,
          },
  };
}

async function beginFlow(options: {
  readonly scopesSupported?: string[];
  readonly resourceScopesSupported?: string[];
} = {}): Promise<{
  readonly authorizationUrl: URL;
  readonly registerScopes: Array<string | undefined>;
  readonly cancel: () => Promise<void>;
}> {
  const authServer = await startFakeAuthServer();
  const service = new McpOAuthService({ store: createMemoryMcpOAuthStore() });
  const provider = service.getProvider(SERVER_NAME, SERVER_URL);
  await provider.ready;
  await provider.saveDiscoveryState(authServerState(authServer.url, options));
  const flow = await service.beginAuthorization(SERVER_NAME, SERVER_URL);
  return {
    authorizationUrl: flow.authorizationUrl,
    registerScopes: authServer.registerScopes,
    cancel: () => flow.cancel(),
  };
}

interface DiscoveryAuthServer extends FakeAuthServer {
  readonly discoveryRequests: { resource: number; authorizationServer: number };
}

async function startDiscoveryAuthServer(options: {
  readonly scopesSupported?: string[];
  readonly resourceScopesSupported?: string[];
}): Promise<DiscoveryAuthServer> {
  const registerScopes: Array<string | undefined> = [];
  const discoveryRequests = { resource: 0, authorizationServer: 0 };
  const httpServer: HttpServer = createHttpServer((req, res) => {
    const path = req.url ?? '';
    if (req.method === 'GET' && path.includes('oauth-protected-resource')) {
      discoveryRequests.resource += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          resource: serverUrl,
          authorization_servers: [serverUrl],
          scopes_supported: options.resourceScopesSupported,
        }),
      );
      return;
    }
    if (req.method === 'GET' && path.includes('oauth-authorization-server')) {
      discoveryRequests.authorizationServer += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer: serverUrl,
          authorization_endpoint: `${serverUrl}/authorize`,
          token_endpoint: `${serverUrl}/token`,
          registration_endpoint: `${serverUrl}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_methods_supported: ['none'],
          scopes_supported: options.scopesSupported,
        }),
      );
      return;
    }
    if (req.method === 'POST' && path === '/register') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf-8');
      });
      req.on('end', () => {
        const metadata = JSON.parse(body) as Record<string, unknown>;
        const scope = metadata['scope'];
        registerScopes.push(typeof scope === 'string' ? scope : undefined);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ ...metadata, client_id: `test-client-${String(registerScopes.length)}` }),
        );
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  registerHttpCleanup(httpServer);
  const { port } = httpServer.address() as AddressInfo;
  const serverUrl = `http://127.0.0.1:${String(port)}`;
  return { url: serverUrl, registerScopes, discoveryRequests };
}

describe('McpOAuthService offline_access request scope', () => {
  it('requests offline_access when the authorization server advertises it', async () => {
    const flow = await beginFlow({
      scopesSupported: ['openid', 'offline_access'],
      resourceScopesSupported: ['openid'],
    });
    expect(flow.authorizationUrl.searchParams.get('scope')).toBe('openid offline_access');
    expect(flow.registerScopes).toEqual(['openid offline_access']);
    await flow.cancel();
  });

  it('requests no scope when the authorization server does not advertise offline_access', async () => {
    const flow = await beginFlow({
      scopesSupported: ['openid'],
      resourceScopesSupported: [],
    });
    expect(flow.authorizationUrl.searchParams.get('scope')).toBeNull();
    expect(flow.registerScopes).toEqual([undefined]);
    await flow.cancel();
  });

  it('discovers the server metadata once and caches it for the ensuing auth call', async () => {
    const authServer = await startDiscoveryAuthServer({
      scopesSupported: ['openid', 'offline_access'],
      resourceScopesSupported: ['openid'],
    });
    const service = new McpOAuthService({ store: createMemoryMcpOAuthStore() });

    const flow = await service.beginAuthorization(SERVER_NAME, authServer.url);

    expect(flow.authorizationUrl.searchParams.get('scope')).toBe('openid offline_access');
    expect(authServer.registerScopes).toEqual(['openid offline_access']);
    expect(authServer.discoveryRequests).toEqual({ resource: 1, authorizationServer: 1 });
    const cached = await service.getProvider(SERVER_NAME, authServer.url).discoveryState();
    expect(cached?.authorizationServerMetadata?.scopes_supported).toEqual([
      'openid',
      'offline_access',
    ]);
    await flow.cancel();
  });
});
