import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { verifySmtp } from './mailer';
import { corsOrigins } from './cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Only the web app and the website (cors.ts); without APP_BASE_URL every origin, as before.
  app.enableCors({ origin: corsOrigins() });
  app.setGlobalPrefix('api/v1');
  // Notifications' WebSocket gateway (path '/ws/notifications') shares this same HTTP
  // server/port — only upgrade requests on that path are intercepted, every REST route
  // is untouched. No Caddy changes needed: reverse_proxy already forwards WS upgrades.
  app.useWebSocketAdapter(new WsAdapter(app));
  const port = Number(process.env.API_PORT ?? 8001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`api listening on ${port}`);
  if (!process.env.DOCUMENTS_KEY) {
    // eslint-disable-next-line no-console
    console.warn('WARNING: DOCUMENTS_KEY is not set: uploaded documents are stored unencrypted. Generate one with `openssl rand -base64 32`.');
  }
  // In the background: a slow or unreachable relay must not hold up the start.
  void verifySmtp();
  if (!process.env.DATABASE_URL) {
    // Offline mode is deliberate (endpoints return empty/offline shapes), but it looks like
    // success from the UI — e.g. every login "works" and does nothing — so say so loudly.
    // eslint-disable-next-line no-console
    console.warn(
      'WARNING: DATABASE_URL is not set — running in OFFLINE mode, nothing is read or written. ' +
        'Start it with npm run dev:api, or set DATABASE_URL.',
    );
  }
}
bootstrap().catch((err: NodeJS.ErrnoException) => {
  // eslint-disable-next-line no-console
  console.error(
    err?.code === 'EADDRINUSE'
      ? `ERROR: port ${process.env.API_PORT ?? 8001} is already in use (another API still running?)`
      : err,
  );
  process.exit(1);
});
