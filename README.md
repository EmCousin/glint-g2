# Glint G2

Read Signal, WhatsApp, and HEY conversations on Even G2 glasses and reply by
voice. Glint runs a bridge on your computer and connects to it through Tailscale.
The unified app lets you switch between all three services on the glasses.

## Set up your computer

Use a Linux computer that stays on, Node.js 22 or newer, npm, OpenSSL, and
[Tailscale](https://tailscale.com/download). Install Python 3 with virtualenv
support if you want voice replies. Sign in to the same Tailscale network on
your computer and phone.

```sh
git clone https://github.com/EmCousin/glint-g2.git
cd glint-g2
./setup.sh
```

Setup installs dependencies, prepares Whisper for transcription, and creates
the `.env` files with a random bridge token. It leaves existing `.env` files
unchanged. The authoritative token is `BRIDGE_TOKEN` in
`apps/unified/bridge/.env`; keep it private.

## Connect your accounts

Edit `apps/unified/bridge/.env`. All services start with mock data. Enable only
the services you need with `PROVIDERS`, for example `PROVIDERS=whatsapp,hey`.

### WhatsApp

Set `MESSAGING_PROVIDER=whatsapp`. When you start the bridge, scan the QR code
from **WhatsApp > Settings > Linked Devices > Link a Device**.

For a pairing code instead, set `WHATSAPP_PHONE_NUMBER` to your number with its
country code and no `+`. Linked-device credentials are stored locally; keep
those files private too.

### HEY

Install the [HEY CLI](https://github.com/basecamp/hey-cli), then sign in:

```sh
hey auth login
hey auth status
```

Set `HEY_PROVIDER=hey`. If you use multiple accounts, set `HEY_ACCOUNT` to the
account you want. `HEY_BOX` defaults to `imbox`.

### Signal

Install [signal-cli](https://github.com/AsamK/signal-cli),
[Gurk](https://github.com/boxdot/gurk-rs), and SQLCipher. Gurk provides local
conversation history; signal-cli sends replies and receives new messages.
Link signal-cli to your Signal account and run Gurk once to initialize it.

```sh
signal-cli link -n "Glint"
# Follow the linking instructions, then use your account number below.
signal-cli -a +15551234567 daemon --socket
```

Keep the daemon running. Set `SIGNAL_PROVIDER=gurk` and `SIGNAL_ACCOUNT` to your
account number. The bridge uses Gurk's standard config and data locations;
override them with `GURK_CONFIG` and `GURK_DATA_DIR` if needed. Set
`GURK_PASSPHRASE` if your database is encrypted, and `SIGNAL_SOCKET` if your
daemon uses a nondefault socket.

## Start the bridge

For voice replies, set `WHISPER_PYTHON` in the unified bridge's `.env` to the
**absolute path** of this checkout's `.venv/bin/python`. `WHISPER_MODEL` defaults
to `base`; the first transcription downloads the model.

```sh
npm run start:unified
```

Keep it running. In another terminal, expose it privately over Tailscale HTTPS:

```sh
tailscale serve --bg http://127.0.0.1:8786
```

Use the HTTPS address Tailscale prints for the next steps. The bridge stays on
localhost, and Tailscale handles the encrypted connection. Don't expose the
bridge to the public internet or remove token authentication.

## Install on your glasses

1. In `apps/unified/plugin/app.json`, replace the network permission's
   `whitelist` entry with your Tailscale HTTPS origin, such as
   `https://your-computer.your-network.ts.net`. Packaged apps can only reach
   approved origins.
2. Run `npm run pack:unified`.
3. Transfer `apps/unified/plugin/glint.ehpk` to your phone and install it through
   the Even app.
4. Open Glint's mobile companion and enter:

| Setting | Value |
| --- | --- |
| Bridge endpoint | Your Tailscale HTTPS URL, without `/signal`, `/whatsapp`, or `/hey` |
| Token | `BRIDGE_TOKEN` from `apps/unified/bridge/.env` |

Tap **Save and connect**, then choose a service on the glasses. Keep Tailscale
connected on both the phone and computer.

## If it doesn't connect

- **Bridge unavailable:** check that the bridge is running, Tailscale is
  connected on both devices, and the endpoint matches the manifest's allowlist.
- **Unauthorized:** check the companion token against the unified bridge's `.env`.
- **Service offline:** read its status in the companion and the bridge logs.
  Check Signal's daemon, WhatsApp's linked device, or `hey auth status`.
- **Voice replies fail:** check `WHISPER_PYTHON` and that setup installed
  `faster-whisper` in that virtualenv.

## Development

```sh
npm run simulate:unified
npm test
npm run build
```

The simulator uses the fixed token `glint-dev`; use the generated token for
your real installation. Services use mock data unless you enable live providers
in their `.env` files.

`apps/` contains separate Signal, WhatsApp, HEY, and unified apps.
`packages/bridge` shares the API and transcription code;
`packages/g2-plugin` shares the glasses and companion runtime. Standalone
bridges use ports `8787` (Signal), `8788` (WhatsApp), and `8789` (HEY).

## License

[MIT](LICENSE).
