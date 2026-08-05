# livestream-slack-bridge

Local TypeScript service for authenticating a YouTube account and preparing a Slack-to-YouTube livestream bridge.

## Current Status

The first implementation slice is in place:

- local Express server
- Google OAuth start and callback routes
- refresh-token capture flow
- YouTube channel verification route

Slack bridging and active livestream detection are not implemented yet.

## Requirements

- Node.js
- npm
- Google OAuth client configured for `http://localhost:3400/oauth/google/callback`

## Environment

Create a local `.env` file with:

```dotenv
PORT=3400
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3400/oauth/google/callback
GOOGLE_REFRESH_TOKEN=
```

Use [.env.example](/home/justin/code/livestream-slack-bridge/.env.example) as the template.

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Run

```bash
npm run start
```

When the service starts successfully, it listens on `http://localhost:3400`.

## OAuth Flow

1. Start the service.
2. Open `http://localhost:3400/oauth/google/start` in your browser.
3. Sign in with the Google account that owns the YouTube channel.
4. Approve the requested YouTube permission.
5. After the callback succeeds, copy the printed `GOOGLE_REFRESH_TOKEN` into `.env`.
6. Restart the service.
7. Open `http://localhost:3400/youtube/me` to confirm the saved refresh token works.

## Routes

- `GET /` shows the local authorization and verification URLs.
- `GET /health` reports whether the service is up and whether a refresh token is configured at startup.
- `GET /oauth/google/start` begins the Google OAuth flow.
- `GET /oauth/google/callback` handles the Google redirect and verifies the YouTube account.
- `GET /youtube/me` checks the configured refresh token against the authenticated YouTube channel.

## Next Steps

- detect the active YouTube livestream broadcast
- obtain the active `liveChatId`
- add Slack authentication and channel configuration
- bridge messages between YouTube live chat and Slack
