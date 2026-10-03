# Glint G2

Private Even G2 integrations for Signal, WhatsApp, and HEY. Each provider
runs as an HTTP bridge on the workstation; the glasses plugin connects to
the bridge over Tailscale to display conversations and transcribe voice
replies.

## Structure

```
apps/
  signal/         Signal bridge and plugin
  whatsapp/       WhatsApp bridge and plugin
  hey/            HEY bridge and plugin
  unified/        Single bridge + plugin that serves all three providers
packages/
  bridge/         Shared API framework, drafts, and Whisper transcription
  g2-plugin/      Shared glasses and mobile companion runtime
```

Each app has two workspaces: `bridge/` (Node server) and `plugin/` (Vite
build that produces an `.ehpk` package for the Even Hub).

## Prerequisites

- Node.js >= 20 (managed by mise)
- Python 3 with a virtualenv containing `faster-whisper` and `numpy`
  (for voice transcription)
- Tailscale, so the glasses can reach the workstation

Provider-specific requirements:

| Provider | Requires |
|----------|----------|
| Signal   | [signal-cli](https://github.com/AsamK/signal-cli) daemon, [Gurk](https://github.com/boxdot/gurk-rs) data directory, `sqlcipher` |
| WhatsApp | Nothing extra. Baileys links as a companion device on first run. |
| HEY      | [HEY CLI](https://github.com/basecamp/hey-cli) authenticated (`hey whoami`) |

## Quick start

```sh
git clone <repo> glint-g2
cd glint-g2
./setup.sh
```

`setup.sh` handles everything in one shot:

1. Checks prerequisites (Node >= 20, Python 3, Tailscale)
2. Runs `npm install` across all workspaces
3. Creates a Python virtualenv with `faster-whisper` and `numpy` for
   voice transcription
4. Copies every `.env.example` to `.env` and injects a generated bridge
   token

Once it finishes, start the simulator:

```sh
npm run simulate:unified       # all providers with mock data
```

### Manual install

If you prefer to set things up by hand:

```sh
npm install

# Voice transcription (optional)
python3 -m venv .venv
.venv/bin/pip install faster-whisper numpy

# Environment files — copy whichever bridges you need
cp apps/unified/bridge/.env.example  apps/unified/bridge/.env
cp apps/signal/bridge/.env.example   apps/signal/bridge/.env
cp apps/whatsapp/bridge/.env.example apps/whatsapp/bridge/.env
cp apps/hey/bridge/.env.example      apps/hey/bridge/.env

# Generate a bridge token and paste it into each .env
openssl rand -hex 32
```

## Configuration

### Signal

Set `SIGNAL_PROVIDER=gurk` and configure the Gurk paths. signal-cli must
be running as a daemon (`signal-cli -a +NUMBER daemon --socket`) so the
bridge can send messages through its JSON-RPC socket.

### WhatsApp

Set `MESSAGING_PROVIDER=whatsapp`. On first start the bridge prints a QR
code (or pairing code if `WHATSAPP_PHONE_NUMBER` is set). Scan it from
WhatsApp > Linked Devices. Auth credentials are stored in
`data/whatsapp-auth/`.

### HEY

Set `HEY_PROVIDER=hey`. The `hey` CLI must be installed and authenticated.
Set `HEY_ACCOUNT` if you have multiple linked accounts.

## Development

Each provider can be started individually or through the simulator, which
launches the bridge, Vite dev server, and Even Hub simulator together:

```sh
# Individual provider
npm run simulate:signal
npm run simulate:whatsapp
npm run simulate:hey

# With live providers (not mock data)
npm run simulate:signal:gurk
npm run simulate:whatsapp:live
npm run simulate:hey:live

# Unified (all providers, one bridge)
npm run simulate:unified
```

To run bridge and plugin separately:

```sh
npm run dev:signal:bridge     # or dev:whatsapp:bridge, dev:hey:bridge, dev:unified:bridge
npm run dev:signal:plugin     # or dev:whatsapp:plugin, dev:hey:plugin, dev:unified:plugin
```

### Default ports

| Service          | Port |
|------------------|------|
| Signal bridge    | 8787 |
| WhatsApp bridge  | 8788 |
| HEY bridge       | 8789 |
| Unified bridge   | 8786 |
| Signal plugin    | 5173 |
| WhatsApp plugin  | 5174 |
| HEY plugin       | 5175 |
| Unified plugin   | 5176 |

## Unified bridge

`apps/unified/bridge` loads all three providers into a single Express
process and mounts them at path prefixes:

```
GET /providers                     provider discovery (status + capabilities)
GET /health                        root health check
    /signal/*                      Signal bridge API
    /whatsapp/*                    WhatsApp bridge API
    /hey/*                         HEY bridge API
```

The unified plugin shows a provider picker on the glasses at launch, then
hands off to the shared `startGlintPlugin()` runtime. The selected
provider is remembered across sessions.

Control which providers load with the `PROVIDERS` env var (default:
`signal,whatsapp,hey`).

## Build and pack

```sh
npm run build           # build all plugins
npm run pack            # build + package all .ehpk files
npm run pack:unified    # just the unified plugin
```

## Production (systemd)

Each bridge has a systemd user service. The services read their `.env`
file and run the monorepo entrypoint.

### Install a service

```sh
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/glint-signal-bridge.service << 'EOF'
[Unit]
Description=Glint Signal HTTP bridge
Wants=network-online.target signal-cli.service
After=network-online.target signal-cli.service

[Service]
Type=simple
WorkingDirectory=/path/to/glint-signal/bridge
Environment=NODE_ENV=production
EnvironmentFile=/path/to/glint-signal/bridge/.env
ExecStart=/path/to/node /path/to/glint-g2/apps/signal/bridge/src/index.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now glint-signal-bridge
```

Repeat for `glint-whatsapp-bridge` and `glint-hey-bridge` (adjusting
ports, working directories, and the `ExecStart` path). For the unified
bridge, a single service replaces all three.

### Service management

```sh
systemctl --user status glint-signal-bridge
systemctl --user restart glint-signal-bridge
journalctl --user -u glint-signal-bridge -f
```

## Plugin installation

After packing, install the `.ehpk` on the glasses through the Even Hub:

1. `npm run pack` (or `npm run pack:unified`)
2. Transfer the `.ehpk` file to your phone
3. Open the Even app and install the package
4. Open the plugin's mobile companion to enter the bridge URL and token

## Troubleshooting

When a provider is not set up correctly on the workstation, the bridge
probes it at startup and reports the issue. The glasses show the error
in the provider picker; the mobile companion shows a status card with
the detail.

### Common setup errors

| What you see on the device | Cause | Fix |
|---|---|---|
| **Signal — offline** / "signal-cli socket not found" | signal-cli daemon is not running | Start it: `signal-cli -a +NUMBER daemon --socket` |
| **Signal — offline** / "signal-cli is not responding" | Daemon is running but the socket path is wrong | Check `SIGNAL_SOCKET` in your `.env` and verify with `ls /run/user/$(id -u)/signal-cli/socket` |
| **WhatsApp — logged out** | WhatsApp session expired on the phone | Delete `data/whatsapp-auth/`, restart the bridge, and scan the new QR code |
| **WhatsApp — offline** | Baileys lost its connection | The bridge retries automatically. If it persists, restart the bridge. |
| **HEY — not installed** | `hey` CLI binary not found | Install the [HEY CLI](https://github.com/basecamp/hey-cli) and ensure it is on your `PATH` (or set `HEY_PATH`) |
| **HEY — not installed** / "not authenticated" | CLI is installed but not logged in | Run `hey login` on the workstation |
| **Bridge unavailable** | The glasses cannot reach the bridge at all | Verify Tailscale is running on both devices and the bridge URL is correct |
| **Setup required** | No bridge URL or token configured | Open the mobile companion and enter the endpoint and token |
| **Provider — setup error** | Provider crashed during bridge startup | Check `journalctl --user -u glint-*-bridge -f` for the full error |

### Verifying workstation setup

Use these commands to check each provider independently before
connecting from the glasses:

```sh
# Bridge health (unified)
curl -s http://127.0.0.1:8786/health | jq .

# Provider status (unified — includes detail for broken providers)
curl -s http://127.0.0.1:8786/providers | jq .

# Signal: verify signal-cli is reachable
echo '{"jsonrpc":"2.0","id":1,"method":"listAccounts"}' | socat - UNIX-CONNECT:/run/user/$(id -u)/signal-cli/socket

# WhatsApp: check connection state
curl -s http://127.0.0.1:8786/whatsapp/health | jq .

# HEY: verify CLI works
hey whoami
```
