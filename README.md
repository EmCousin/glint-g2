# Glint G2

Licensed under the [MIT License](LICENSE).

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

## Workstation setup

The bridge runs on a Linux workstation (or any machine that stays on).
The glasses reach it over Tailscale. Set things up once; after that
`./setup.sh` and `npm run simulate:unified` is all you need.

### 1. Core dependencies

```sh
# Node.js >= 20 — install with mise, nvm, or your package manager
mise use node@20        # or: nvm install 20 && nvm use 20
node --version          # should print v20.x or higher

# Python 3 — needed for voice transcription (faster-whisper)
python3 --version       # should print 3.x
```

### 2. Tailscale

Tailscale creates a private network so the glasses can reach the
workstation from anywhere. Both the workstation and the phone running
the Even app must be on the same tailnet.

```sh
# Install (Arch)
sudo pacman -S tailscale
# Install (Debian / Ubuntu)
curl -fsSL https://tailscale.com/install.sh | sh

sudo systemctl enable --now tailscaled
sudo tailscale up

# Verify
tailscale status                     # should list this machine
tailscale ip -4                      # note the 100.x.y.z address
```

Use the Tailscale IP (or MagicDNS hostname) as the bridge URL when
configuring the plugin on the glasses.

### 3. Clone and run setup

```sh
git clone <repo> glint-g2
cd glint-g2
./setup.sh
```

`setup.sh` handles:

1. Checks Node >= 20, Python 3, and Tailscale
2. Runs `npm install` across all workspaces
3. Creates a `.venv` with `faster-whisper` and `numpy` for voice
   transcription
4. Copies every `.env.example` to `.env` and injects a random bridge
   token

After setup you can already run with mock data:

```sh
npm run simulate:unified       # all providers, mock conversations
```

To use real providers, continue with the sections below.

### 4. Signal provider

Signal requires three pieces on the workstation: **signal-cli** (sends
and receives messages), **Gurk** (provides the conversation database),
and **sqlcipher** (reads the encrypted database).

#### Install signal-cli

```sh
# Arch
sudo pacman -S signal-cli

# Other distros — download the release tarball
VERSION=0.13.12  # check https://github.com/AsamK/signal-cli/releases
curl -LO "https://github.com/AsamK/signal-cli/releases/download/v${VERSION}/signal-cli-${VERSION}-Linux.tar.gz"
sudo tar xf "signal-cli-${VERSION}-Linux.tar.gz" -C /opt
sudo ln -sf /opt/signal-cli-${VERSION}/bin/signal-cli /usr/local/bin/signal-cli
```

#### Register or link your phone number

```sh
# Option A: link to an existing Signal account on your phone
signal-cli link -n "Glint workstation"
# Scan the QR code with Signal > Settings > Linked Devices

# Option B: register a new number (needs a phone that can receive SMS)
signal-cli -a +15551234567 register
signal-cli -a +15551234567 verify CODE
```

#### Start the daemon

```sh
signal-cli -a +15551234567 daemon --socket
# The socket appears at /run/user/$(id -u)/signal-cli/socket
```

To run it permanently, create a systemd user service (see the
Production section below) or add it to your session startup.

#### Install sqlcipher

```sh
# Arch
sudo pacman -S sqlcipher

# Debian / Ubuntu
sudo apt install sqlcipher
```

#### Install Gurk

[Gurk](https://github.com/boxdot/gurk-rs) is a TUI Signal client
whose local database the bridge reads for conversation history.

```sh
cargo install gurk
gurk    # run once to initialise the config and database
```

#### Configure the bridge

Edit `apps/unified/bridge/.env` (or `apps/signal/bridge/.env`):

```sh
SIGNAL_PROVIDER=gurk
GURK_CONFIG=$HOME/.config/gurk/gurk.toml
GURK_DATA_DIR=$HOME/.local/share/gurk
GURK_PASSPHRASE=<your gurk passphrase, if set>
SQLCIPHER_PATH=/usr/bin/sqlcipher
SIGNAL_SOCKET=/run/user/1000/signal-cli/socket
SIGNAL_ACCOUNT=+15551234567
```

#### Verify

```sh
# signal-cli responds?
echo '{"jsonrpc":"2.0","id":1,"method":"listAccounts"}' \
  | socat - UNIX-CONNECT:/run/user/$(id -u)/signal-cli/socket

# sqlcipher installed?
sqlcipher --version

# Start the bridge with live Signal
npm run simulate:signal:gurk
```

### 5. WhatsApp provider

WhatsApp has **no system-level dependencies** — the Baileys library
(installed by `npm install`) handles everything. On first start the
bridge links as a companion device, like WhatsApp Web.

#### Configure the bridge

Edit `apps/unified/bridge/.env` (or `apps/whatsapp/bridge/.env`):

```sh
MESSAGING_PROVIDER=whatsapp
# Optional: set your phone number to get a pairing code instead of a QR
# WHATSAPP_PHONE_NUMBER=15551234567
```

#### Link the device

```sh
npm run simulate:whatsapp:live
```

The bridge prints a QR code in the terminal. Scan it from
**WhatsApp > Settings > Linked Devices > Link a Device**.

If `WHATSAPP_PHONE_NUMBER` is set, it prints a pairing code instead.

Auth credentials are stored in `data/whatsapp-auth/`. Delete that
directory to re-link.

#### Verify

```sh
curl -s http://127.0.0.1:8788/health | jq .
# Should show: { "status": "ok", "provider": "whatsapp", "connection": "open" }
```

### 6. HEY provider

HEY requires the [HEY CLI](https://github.com/basecamp/hey-cli) to
be installed and authenticated on the workstation.

#### Install the HEY CLI

```sh
# Via Homebrew (Linux or macOS)
brew install basecamp/tap/hey

# Or download from GitHub releases
# https://github.com/basecamp/hey-cli/releases
```

Make sure the binary is on your `PATH`:

```sh
which hey         # should print a path
hey whoami        # should print your HEY account email
```

If `hey whoami` fails, authenticate first:

```sh
hey login
```

#### Configure the bridge

Edit `apps/unified/bridge/.env` (or `apps/hey/bridge/.env`):

```sh
HEY_PROVIDER=hey
# HEY_ACCOUNT=work             # only if you have multiple linked accounts
# HEY_BOX=imbox                # default box to show (imbox, feed, paper_trail)
# HEY_PATH=/usr/local/bin/hey  # only if hey is not on your PATH
```

#### Verify

```sh
hey whoami
npm run simulate:hey:live
```

### 7. Voice transcription (optional)

`setup.sh` already creates the virtualenv. If you skipped it or need
to set it up manually:

```sh
python3 -m venv .venv
.venv/bin/pip install faster-whisper numpy
```

Then point the bridge at it in your `.env`:

```sh
WHISPER_PYTHON=.venv/bin/python
WHISPER_MODEL=base              # tiny, base, small, medium, large-v3
# WHISPER_LANGUAGE=en           # auto-detect if blank
```

The first transcription downloads the model (~150 MB for `base`).

### Manual install (without setup.sh)

If you prefer to skip the script entirely:

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
