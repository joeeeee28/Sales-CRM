import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config.js';
import { errorHandler, asyncHandler } from './lib/errors.js';
import { loadSessionUser } from './lib/auth.js';
import { withRequestIdentity } from './db/index.js';
import { storefrontRouter } from './routes/storefront.js';
import { checkoutRouter } from './routes/checkout.js';
import { accountRouter } from './routes/account.js';
import { adminRouter } from './routes/admin.js';
import { injectMeta, metaForPath, readShell, buildSitemap, robotsTxt } from './lib/seo.js';
import { sendEmail, emailTemplates } from './lib/email.js';
import { getSettings } from './lib/settings.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // capture raw body for webhook signature verification
  app.use('/api/webhooks', express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // session → req.user, and push identity into Postgres RLS GUCs per request
  app.use('/api', (req, res, next) => {
    loadSessionUser(req)
      .then((user) => {
        req.user = user ?? undefined;
        return withRequestIdentity(user?.id ?? null, user?.role ?? null, async () => {
          next();
        });
      })
      .catch(next);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: config.version, env: config.env, time: new Date().toISOString() });
  });

  app.use('/api', storefrontRouter);
  app.use('/api', checkoutRouter);
  app.use('/api', accountRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'API route not found' } }));

  /* ------------------------- SEO files ------------------------------------ */
  app.get('/sitemap.xml', asyncHandler(async (_req, res) => {
    res.type('application/xml').send(await buildSitemap());
  }));
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(robotsTxt()));

  /* ------------------------- media & static -------------------------------- */
  app.use('/media', express.static(paths.mediaDir, { maxAge: '30d', index: false }));

  const hasDist = fs.existsSync(paths.publicDir);
  if (hasDist) {
    app.use(express.static(paths.publicDir, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    } }));
  }

  /* ------------------------- HTML shell with server-injected SEO ---------- */
  app.get('*', asyncHandler(async (req: Request, res: Response) => {
    if (!req.accepts('html')) {
      res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
      return;
    }
    const shell = readShell();
    if (!shell) {
      // dev mode without a build: hand the request to Vite if it is running
      res.status(200).type('html').send(
        `<!doctype html><meta charset="utf-8"><title>Build required</title><body style="font-family:sans-serif;padding:40px">
         <h1>Storefront not built</h1><p>Run <code>npm run build</code> (or use <code>npm run dev</code> with the Vite server on :5173).</p>`
      );
      return;
    }
    const pathname = req.path === '/' ? '/' : req.path.replace(/\/+$/, '');
    const meta = await metaForPath(pathname);
    res.type('html').send(injectMeta(shell, meta));
  }));

  app.use(errorHandler());
  return app;
}

export { sendEmail, emailTemplates, getSettings };
export type { Request, Response };
export const staticDir = path.join(paths.publicDir);
