# PostgreSQL for Local

A [Local](https://localwp.com) add-on that installs, runs and manages a **PostgreSQL server for each site**. You don't need Docker, Homebrew or a system-wide install.

- **One-click install.** Downloads a portable PostgreSQL build (14 – 18) and checks it against the published SHA-256 checksum, which catches corrupted downloads.
- **One cluster per site.** Each site gets its own data directory, port, password and default `local` database.
- **Follows the site.** PostgreSQL starts when the site starts and stops when it stops (you can turn this off per site). When Local quits, every server is stopped.
- **Manage from Local.** The **Tools → PostgreSQL** tab has start/stop/restart, connection details with copy buttons, a `DATABASE_URL` snippet, create/drop databases, the server log, and installed versions.
- **Private by default.** Servers listen only on `127.0.0.1`, with unix sockets off and SCRAM-SHA-256 password auth.

## Requirements

- Local 6 or newer (built and checked against Local 10.2)
- Linux (x64/arm64, glibc), macOS (Intel/Apple Silicon) or Windows 10+ (x64/arm64)
- `tar` on the `PATH`. Linux and macOS have it, and Windows 10+ ships `tar.exe`.

## Install

1. Quit Local.
2. From this folder, run:

   ```bash
   npm run install-addon
   ```

   This copies the add-on into Local's add-ons folder and marks it enabled:
   - Linux: `~/.config/Local/addons/`
   - macOS: `~/Library/Application Support/Local/addons/`
   - Windows: `%APPDATA%\Local\addons\`

3. Start Local, open a site, and go to **Tools → PostgreSQL**.

During development, `npm run link-addon` symlinks the folder so your edits load on the next Local restart. To uninstall, run `npm run uninstall-addon`.

## Using it

1. Open a site → **Tools → PostgreSQL**.
2. Choose a version and click **Download & enable**. The first download is about 40 MB.
3. Copy the connection details, or the `DATABASE_URL` line, into your app:

   ```
   DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/local
   ```

   From a terminal:

   ```bash
   psql -h 127.0.0.1 -p 5432 -U postgres local
   ```

The first site gets port 5432 when it's free. Each later site gets the next free port.

## Where things live

Everything is under Local's data folder in `postgresql/`:

| Path | Contents |
| --- | --- |
| `config.json` | per-site port, user, password, version, auto-start |
| `versions/<version>/` | PostgreSQL binaries, shared by all sites |
| `sites/<siteId>/data/` | the site's cluster |
| `sites/<siteId>/postgres.log` | server log |
| `addon.log` | add-on activity and errors |

Deleting a site in Local also stops and deletes its PostgreSQL cluster. **Remove PostgreSQL** in the tab does the same without deleting the site.

## Development

```bash
npm install
npm test
npm run coverage
```

The add-on is plain CommonJS with no runtime dependencies and no build step. The React UI uses Local's own React instance, and the tests render it with React 16.14, the version Local ships.

```
lib/
  main.js             main-process entry: wires the service, IPC and site hooks
  renderer.js         renderer entry: adds the Tools → PostgreSQL tab
  postgresService.js  business logic used by IPC and lifecycle hooks
  binaryManager.js    download → verify → extract PostgreSQL builds
  instanceManager.js  initdb / pg_ctl / psql / createdb / dropdb per site
  configStore.js      atomic, serialised JSON settings store
  ipc.js              channel → service routing
  ui/                 panel container, sections, components, styles, IPC client
```

## Notes

- Binaries come from [theseus-rs/postgresql-binaries](https://github.com/theseus-rs/postgresql-binaries). Edit `SUPPORTED_VERSIONS` in `lib/constants.js` to offer other releases.
- PostgreSQL refuses to run as root. Run Local as your normal user.
- Passwords are random and stored in `config.json` (mode 0600) on your machine. They are never logged or passed on the command line.
