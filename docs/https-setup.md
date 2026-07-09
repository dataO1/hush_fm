# HushFM HTTPS Setup Guide

Real TLS certificate for `hushfm.dedyn.io` via Let's Encrypt DNS-01 challenge
(deSEC free dynamic DNS provider, lego ACME client built into NixOS).

---

## 1. deSEC Account and Domain

### 1a. Register at deSEC

1. Go to https://desec.io and click **Sign up**.
2. Register with your email address. Confirm via the link sent to you.
3. Log in to the deSEC dashboard.

### 1b. Create the domain

1. In the dashboard, click **Create new domain**.
2. Enter `hushfm.dedyn.io` in the subdomain field (deSEC offers free `*.dedyn.io` subdomains).
3. Click **Create**. The domain is provisioned immediately with deSEC's nameservers.

### 1c. Create an API token

1. In the dashboard, click your account name → **Token management**.
2. Click **Generate token**.
3. Give it a name (e.g., `hushfm-acme`) and leave the permissions at the default
   (the token needs write access to `hushfm.dedyn.io` DNS records).
4. Copy the token value — it is shown only once.

### 1d. Token storage — sops-nix (declarative; ACTUAL SETUP as of 2026-07-03)

The token is NOT stored as a plain file. It lives **sops-encrypted inside the
Pi's system config repo** and is decrypted automatically at every system
activation:

| What | Where |
|---|---|
| Encrypted token (safe to commit/push) | `/etc/nixos/secrets/desec.env` (sops, age-encrypted, dotenv content `DESEC_TOKEN=...`) |
| Decrypted at runtime (by sops-nix) | `/run/secrets/desec-env` (tmpfs, root-only, recreated each activation) |
| Wiring | `configuration.nix`: `sops.secrets."desec-env" = { sopsFile = ./secrets/desec.env; format = "binary"; };` and `services.hushfm.acme.credentialsFile = config.sops.secrets."desec-env".path;` |
| Decryption key (Pi, automatic) | the Pi's own SSH host key `/etc/ssh/ssh_host_ed25519_key` (via sops-nix) |
| Editing key (admin laptop) | age key at `~/.config/sops/age/keys.txt` — edit secrets with `sops edit /etc/nixos/secrets/desec.env` |
| Recovery of the raw token | user's password vault (canonical backup) — if everything else is lost, re-encrypt with `sops encrypt` using the recipients in `/etc/nixos/.sops.yaml` |

To rotate the token: create a new one in the deSEC UI, then on the laptop
`sops edit` the secret (or re-encrypt), commit, `nixos-rebuild switch`.

---

## 2. NixOS Module Configuration

The `services.hushfm` NixOS module exposes these ACME-related options
(all have sensible defaults matching this setup):

| Option | Default | Purpose |
|---|---|---|
| `services.hushfm.hostName` | `hushfm.dedyn.io` | Domain for cert + nginx server_name |
| `services.hushfm.acme.email` | `daniel.tabellion@gmx.de` | Let's Encrypt account email |
| `services.hushfm.acme.credentialsFile` | `/var/lib/secrets/desec-token.env` | File containing `DESEC_TOKEN=...` |

The default is a plain-file fallback; the actual Pi config overrides it with the
sops-nix secret path (see 1d): `config.sops.secrets."desec-env".path`.

### Deploying (after the one-time bootstrap)

Everything is in `/etc/nixos` (git). A deploy is always exactly:

```sh
# on the Pi (or via ssh — data01 has NOPASSWD sudo for nixos-rebuild only):
cd ~/Projects/hush_fm && git pull && nix develop -c bash -c 'cd backend && cargo build --release'
sudo nixos-rebuild switch --flake /etc/nixos#hushfm
```

### How offline resilience works

NixOS's `security.acme` module generates an `acme-selfsigned-hushfm.dedyn.io.service`
unit that creates a temporary self-signed certificate on first boot. The nginx
systemd unit is ordered:

- `After = acme-selfsigned-hushfm.dedyn.io.service` — nginx always has a cert before it starts.
- `Wants = acme-finished-hushfm.dedyn.io.target` — non-blocking; nginx does not wait for
  a successful ACME renewal.

Consequence: at the party (Pi offline, no internet):

- If the Pi previously obtained a real Let's Encrypt cert, nginx serves it from
  `/var/lib/acme/hushfm.dedyn.io/` regardless of renewal status.
- On a brand-new Pi that has never connected to the internet, nginx starts with
  the bootstrap self-signed cert (guests will see a browser warning until a real
  cert is obtained).

The `acme-hushfm.dedyn.io.timer` runs renewal checks; a failed attempt leaves
the existing cert in place. Nginx is never blocked by ACME failures.

---

## 3. Pre-Party Checklist (do this at home, with internet)

### 3a. Deploy the NixOS configuration

```sh
sudo nixos-rebuild switch --flake /path/to/hush_fm#<hostname>
```

### 3b. Obtain / renew the certificate

```sh
sudo systemctl start acme-hushfm.dedyn.io.service
```

Wait for it to complete (typically 30–90 seconds depending on DNS propagation):

```sh
sudo journalctl -u acme-hushfm.dedyn.io.service -f
# Look for: "Certificates obtained successfully"
```

### 3c. Verify the certificate

```sh
sudo openssl x509 \
  -in /var/lib/acme/hushfm.dedyn.io/cert.pem \
  -noout -enddate -subject
```

Example good output:
```
subject=CN=hushfm.dedyn.io
notAfter=Sep 30 12:00:00 2026 GMT
```

Check that `notAfter` is at least 30 days past the event date. Let's Encrypt
certificates are valid for 90 days; NixOS renews automatically when validity
drops below 30 days.

### 3d. Quick nginx sanity check

```sh
sudo nginx -t           # config test
curl -sk https://hushfm.dedyn.io/ | head -5   # confirm TLS + frontend served
```

---

## 4. Router Configuration (GL.iNet Flint 2 / OpenWrt)

At the party the Pi is on a local network and guests must resolve
`hushfm.dedyn.io` to the Pi's LAN IP instead of the public internet. Configure
the Flint 2's dnsmasq to intercept the domain.

### 4a. Find the Pi's LAN IP

```sh
# On the Pi:
ip -4 addr show | grep inet
# e.g., 192.168.8.100
```

### 4b. Add the dnsmasq DNS override via uci (SSH into Flint 2)

```sh
# Add address record: any query for hushfm.dedyn.io (and *.hushfm.dedyn.io)
# returns the Pi's LAN IP.
uci add dhcp dnsmasq_opts  2>/dev/null; true
uci set dhcp.@dnsmasq[-1].option="address=/hushfm.dedyn.io/192.168.8.100"
uci commit dhcp

# If rebind protection is enabled on the router, whitelist the domain:
uci set dhcp.@dnsmasq[0].rebind_domain="hushfm.dedyn.io"
uci commit dhcp

# Restart dnsmasq to apply:
/etc/init.d/dnsmasq restart
```

Alternatively, you can add a permanent entry via a custom dnsmasq config file:

```sh
echo "address=/hushfm.dedyn.io/192.168.8.100" \
  > /etc/dnsmasq.d/hushfm.conf
/etc/init.d/dnsmasq restart
```

### 4c. Verify from a guest device

Connect a phone or laptop to the party WiFi and open:

```
https://hushfm.dedyn.io
```

The browser should show a valid Let's Encrypt certificate (green padlock, no
warning). No configuration is needed on guest devices — the DHCP-assigned DNS
server (the Flint 2) handles the override transparently.

### 4d. Pi A-record note

You do NOT need to update the deSEC DNS A record to the Pi's LAN IP. The
real public DNS record can point anywhere (or nowhere); guests at the party
use the router's local override, not public DNS.

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `acme-hushfm.dedyn.io.service` fails | Wrong/missing DESEC_TOKEN | Check `/var/lib/secrets/desec-token.env` content + permissions |
| Cert obtained but nginx returns self-signed | Cert group mismatch | Verify `/var/lib/acme/hushfm.dedyn.io/` is group-readable by `nginx` |
| Guests see "not secure" warning | DNS override not active | Run `nslookup hushfm.dedyn.io` on a guest device; should return Pi's LAN IP |
| DNS override returns Pi IP but TLS error | Cert expired or wrong CN | Re-run pre-party checklist step 3b–3c |

---

## 6. Cert-expiry warning (decision 2026-07-09)

The renewal is automatic ONLY if the Pi gets internet at home within the 30-day
window before an event. Miss that and the cert silently ages out → padlock
warning at the door with no prior signal. Safety net (being built):

- **Backend:** `/health` gains a `certDaysRemaining` field — the backend reads
  the LE cert's `notAfter` from `/var/lib/acme/hushfm.dedyn.io/cert.pem` and
  computes days-to-expiry. **Implementation gotcha:** that path is
  group-`nginx` readable; the backend process user needs read access (add it to
  the `nginx`/`acme` group, or point at a group-readable copy, or parse
  `fullchain.pem`). If the cert is unreadable, return `null` (don't fail /health).
- **Frontend (DJ page):** when `certDaysRemaining` is below a threshold
  (e.g. ≤ 14), show a warning banner on the DJ page ("TLS cert expires in N days —
  renew at home before the next event: `sudo systemctl start
  acme-hushfm.dedyn.io.service` with internet"). DJ-only (guests shouldn't see
  ops warnings); the DJ is the operator.
- **Router test script:** `router-party-test.sh` should also surface the cert
  expiry as a PASS/WARN so the pre-party check catches it offline.
