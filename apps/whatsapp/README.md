# Glint WhatsApp

Glint WhatsApp is a private WhatsApp companion for Even G2 glasses. It shows recent personal and group conversations, supports quoted replies and reactions, and transcribes dictated replies locally.

The project has two workspaces:

- `plugin/`: the Even Hub plugin and glasses UI.
- `bridge/`: a token-protected workstation service using WhatsApp's linked-device protocol through Baileys.

WhatsApp credentials remain on the workstation. The glasses communicate only with the private bridge.

> [!WARNING]
> Baileys is an unofficial WhatsApp Web client. It is not affiliated with or endorsed by WhatsApp, and WhatsApp can change the protocol, invalidate a linked session, or restrict an account. Use this only with your own account and do not use it for bulk or automated messaging.

## Install

Run setup commands from this app directory; npm resolves the monorepo root automatically.

```bash
npm install
python3 -m venv bridge/.venv
bridge/.venv/bin/pip install -r bridge/requirements.txt
cp bridge/.env.example bridge/.env
cp plugin/.env.example plugin/.env.local
```

Generate a bridge token with `openssl rand -hex 32` and use the same value in both environment files.

## Pair WhatsApp

Start the real bridge and simulator:

```bash
npm run simulate:whatsapp:live
```

On first start, scan the terminal QR code from **WhatsApp > Settings > Linked devices > Link a device**. To use an eight-character pairing code instead, set `WHATSAPP_PHONE_NUMBER` to the international number containing digits only.

The bridge stores linked-device credentials and its recent-message snapshot under `bridge/data/` by default. This directory is ignored by Git and should be treated as sensitive. History sync can take time on the first connection; conversations appear as WhatsApp supplies them.

For UI development without WhatsApp, run:

```bash
npm run simulate:whatsapp
```

## Voice replies

Voice replies capture 16 kHz mono PCM from the G2 microphone and transcribe it locally with Faster Whisper. The default `base` model downloads on first use. Set `WHISPER_MODEL` or `WHISPER_LANGUAGE` in `bridge/.env` to override recognition settings.

Drafts expire after one minute, are single-use, and lock the conversation, quoted message, and transcript before confirmation.

Scrolling near the bottom of the conversation list loads older conversations. Scrolling near the oldest visible message loads more local history, up to the 100 messages retained per chat by the bridge.

## G2 controls

- Swipe through recent conversations and press to open one.
- Swipe through messages and press one to open the full-screen reader.
- Swipe to page through the complete body, then press to close the reader.
- Hold a collapsed message while dictating a reply, release to transcribe, then press to send.
- Swipe while confirming to cancel the draft.
- Hold a selected message to open reaction actions.
- Double-press to return to conversations or exit.

## Private access

The bridge binds to `127.0.0.1` by default. To reach it from Even Hub, expose it only through a private network such as Tailscale and retain the bearer token as a second layer:

```bash
HOST=$(tailscale ip -4) npm run dev:whatsapp:bridge
```

Set `VITE_BRIDGE_URL` to the private bridge URL. Packaged plugins must also list that exact HTTPS origin in `plugin/app.json`'s network whitelist. Do not expose the bridge publicly.

When Signal and WhatsApp share the same Tailscale hostname, keep Signal at the root route and mount this bridge separately:

```bash
tailscale serve --bg --set-path /whatsapp http://127.0.0.1:8788
```

Then set `VITE_BRIDGE_URL` to `https://your-host.example.ts.net/whatsapp`. The manifest whitelist remains the hostname origin without the path.

## Test and package

```bash
npm test
npm run build
npm run pack:whatsapp
```

The package is written to `plugin/glint-whatsapp.ehpk`.
