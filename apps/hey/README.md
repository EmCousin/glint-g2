# Glint HEY

Glint HEY lets you read and reply to HEY email from Even G2 glasses. It has 2 parts:

- `plugin/`: the Even Hub app shown on the glasses and in the Even mobile app.
- `bridge/`: a token-protected service that runs on your workstation and calls the authenticated `hey` CLI.

HEY credentials stay on the workstation. The glasses receive a compact thread list and plain-text message bodies.

## Requirements

- Node.js 20 or newer
- An authenticated HEY CLI (`hey auth status`)
- Python 3 and Faster Whisper for voice replies

Run setup commands from this app directory; npm resolves the monorepo root automatically.

Install the dependencies:

```bash
npm install
python3 -m venv bridge/.venv
bridge/.venv/bin/pip install -r bridge/requirements.txt
```

## Local development

Run the mock bridge, plugin, and Even Hub simulator:

```bash
npm run simulate:hey
```

Run against your HEY account on separate development ports:

```bash
npm run simulate:hey:live
```

The HEY CLI must already be authenticated. If you have linked accounts, set `HEY_ACCOUNT` to an account ID or name accepted by `hey --account`.

The bridge uses port `8789` by default, leaving `8787` and `8788` available for Glint Signal and Glint WhatsApp.

## Configuration

Create local configuration files:

```bash
cp bridge/.env.example bridge/.env
cp plugin/.env.example plugin/.env.local
```

Use the same `BRIDGE_TOKEN` and `VITE_BRIDGE_TOKEN`. Generate one with `openssl rand -hex 32`.

Bridge settings:

- `HEY_PROVIDER=hey` enables the real HEY adapter. The default is `mock` outside the sample file.
- `HEY_ACCOUNT` selects one linked HEY account. Omit it to use the CLI default.
- `HEY_BOX` selects the box shown on the glasses. It defaults to `imbox`.
- `HEY_PATH` overrides the `hey` executable path.
- `WHISPER_MODEL` defaults to `base`; `WHISPER_LANGUAGE` can pin the recognition language.

The plugin polls the bridge every 5 seconds and loads the next Imbox page when you scroll near the end of the thread list. Bundled HEY rows without a thread ID are omitted because the CLI cannot open or reply to those rows. Unread subjects start with `*`. Opening a thread loads all of its messages because `hey thread read` returns the complete thread.

## Controls

- Swipe on the first screen to select an Imbox thread.
- Press to open the thread.
- Swipe to move through messages.
- Press a message to open the full-screen reader. Swipe to page through the complete body, then press to close it.
- Hold on a message to dictate a reply to the thread.
- Release to transcribe. Press to send the displayed draft, or swipe to cancel it.
- Double press in a thread to return to the thread list.
- Double press from the thread list to exit.

Reply drafts expire after 1 minute. The bridge locks the thread and transcript before confirmation, then runs `hey reply` only after the confirmation press.

## Private network

Expose the local bridge under its own Tailscale Serve path:

```bash
tailscale serve --bg --set-path /hey http://127.0.0.1:8789
```

Set `VITE_BRIDGE_URL` to `https://your-host.example.ts.net/hey`. The manifest whitelist contains the hostname origin without the path. Do not expose the bridge publicly.

For a persistent workstation service, install and enable a user service that runs the bridge from `bridge/` with `HEY_PROVIDER=hey` and `PORT=8789`.

## Package

```bash
npm run pack:hey
```

The package is written to `plugin/glint-hey.ehpk`.
