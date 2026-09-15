/* Read-only Gmail auth for a desktop app.
 *
 * The scope is gmail.readonly and nothing else. This code cannot send, reply,
 * draft, label, archive or delete — the token it asks Google for does not carry
 * the permission to. Keep it that way.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { google } from 'googleapis';

export const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

/**
 * @param {string} credentialsPath  OAuth client JSON (Desktop app) from Google Cloud
 * @param {string} tokenPath        where the refresh token gets cached
 */
export async function authorise(credentialsPath, tokenPath) {
  if (!existsSync(credentialsPath)) {
    throw new Error(
      `No OAuth client at ${credentialsPath}.\n` +
      'Google Cloud Console → APIs & Services → Credentials → Create credentials →\n' +
      'OAuth client ID → Desktop app. Download the JSON and save it there.\n' +
      'Enable the Gmail API for the project first.'
    );
  }

  const raw = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  const { client_id, client_secret } = raw.installed ?? raw.web;
  const port = 4517;
  const client = new google.auth.OAuth2(client_id, client_secret, `http://localhost:${port}`);

  if (existsSync(tokenPath)) {
    client.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')));
    return client;
  }

  const url = client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
  console.log('\nOpen this in a browser and sign in as the mailbox owner:\n\n' + url + '\n');
  console.log('Google shows one checkbox — "View your email messages and settings". Tick it.\n');

  const code = await new Promise((res, rej) => {
    const server = createServer((req, out) => {
      const got = new URL(req.url, `http://localhost:${port}`).searchParams.get('code');
      out.writeHead(200, { 'content-type': 'text/plain' });
      out.end(got ? 'Signed in. You can close this tab.' : 'No code in the callback.');
      server.close();
      got ? res(got) : rej(new Error('No authorisation code returned'));
    });
    server.listen(port);
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  console.log(`Token cached at ${tokenPath} — keep it out of git.\n`);
  return client;
}

export function gmailFor(client) {
  return google.gmail({ version: 'v1', auth: client });
}

export { join };
