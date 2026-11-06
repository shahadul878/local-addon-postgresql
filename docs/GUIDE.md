# PostgreSQL for Local — User Guide

![PostgreSQL for Local](../assets/thumbnail.png)

This guide covers everything from installing the add-on to backing up a database. If you only want the short version, see the [README](../README.md).

**Contents**

1. [What the add-on does](#1-what-the-add-on-does)
2. [Requirements](#2-requirements)
3. [Installing the add-on](#3-installing-the-add-on)
4. [Giving a site its own PostgreSQL](#4-giving-a-site-its-own-postgresql)
5. [Connecting to the database](#5-connecting-to-the-database)
6. [Running the server](#6-running-the-server)
7. [Managing databases](#7-managing-databases)
8. [PostgreSQL versions](#8-postgresql-versions)
9. [Several sites at once](#9-several-sites-at-once)
10. [Backups and moving data](#10-backups-and-moving-data)
11. [Removing PostgreSQL from a site](#11-removing-postgresql-from-a-site)
12. [Uninstalling the add-on](#12-uninstalling-the-add-on)
13. [Troubleshooting](#13-troubleshooting)
14. [Security](#14-security)
15. [Where files live](#15-where-files-live)

---

## 1. What the add-on does

[Local](https://localwp.com) runs WordPress sites with MySQL/MariaDB. This add-on adds a **PostgreSQL server per site**, managed from Local's own window. You don't need Docker, Homebrew or a system-wide PostgreSQL install.

- Each site gets its own server, data folder, port and password.
- The server starts and stops with the site (you can turn this off).
- Everything is managed from **Tools → PostgreSQL** on the site.

> **WordPress itself does not use PostgreSQL.** Local's PHP also has no PostgreSQL driver (`pgsql` / `pdo_pgsql`), so PHP code run by Local can't connect to it. The add-on is for everything else you build next to a site: a Node, Python, Go or Laravel app, a headless front end, data scripts, or a database tool such as TablePlus, DBeaver or pgAdmin.

## 2. Requirements

| | |
| --- | --- |
| Local | 6 or newer. Built and checked against Local 10.2. |
| Linux | x64 or arm64 with glibc 2.34 or newer, e.g. Ubuntu 22.04+, Debian 12+, Fedora 35+. |
| macOS | Intel or Apple Silicon. |
| Windows | 10 or newer, x64 or arm64. |
| Disk | About 120 MB per PostgreSQL version (a 40–90 MB download), plus your data. |
| Internet | Only for downloading a PostgreSQL version the first time. |

Run Local as your normal user, not as root or administrator. PostgreSQL refuses to run as root.

## 3. Installing the add-on

Pick one of the two ways below. Both put the add-on in Local's add-ons folder.

### Option A — Install from disk (no terminal needed)

1. Download `local-addon-postgresql-<version>.tgz` from the [latest release](https://github.com/shahadul878/local-addon-postgresql/releases/latest). Don't unpack it.

   To build the archive yourself instead, run `npm pack` in a copy of this repository.

2. In Local, open **Add-ons** (the puzzle-piece icon) → **Installed** → **Install from disk**, and choose the `.tgz` file.
3. Make sure the add-on's switch is on, then restart Local.

   If Local says *Add-on already exists*, an older copy is installed. Remove it under **Add-ons → Installed** (or run `npm run uninstall-addon`), restart Local, and install again. Your sites' PostgreSQL data is kept.

### Option B — Install script (needs Node.js 18+)

1. Quit Local completely (**Local → Quit**, or **Ctrl+Q** / **Cmd+Q**). Closing the window is not always enough.
2. Download this repository (`git clone https://github.com/shahadul878/local-addon-postgresql.git`, or **Code → Download ZIP** on GitHub and unzip it).
3. In the repository folder, run:

   ```bash
   npm run install-addon
   ```

   This copies the add-on to Local's add-ons folder and switches it on:

   | System | Add-ons folder |
   | --- | --- |
   | Linux | `~/.config/Local/addons/` |
   | macOS | `~/Library/Application Support/Local/addons/` |
   | Windows | `%APPDATA%\Local\addons\` |

4. Start Local.

### Check it worked

Open **Add-ons → Installed**. You should see **PostgreSQL** with its switch on. Then open any site and click the **Tools** tab: there is now a **PostgreSQL** entry.

> Local only loads add-ons when it starts. If the list is empty or the tab is missing, quit Local fully and open it again.

## 4. Giving a site its own PostgreSQL

1. Open the site in Local and go to **Tools → PostgreSQL**.
2. Under **Set up PostgreSQL**, choose a version. The newest stable release is pre-selected; versions already downloaded say *(installed)*.
3. Click **Download & enable** (or **Enable PostgreSQL** if the version is already downloaded).

The add-on then:

1. downloads that PostgreSQL version (40–90 MB depending on your system, only the first time) and checks it against its published SHA-256 checksum;
2. creates a new database cluster for the site with a random password;
3. starts the server on a free port (5432 if nothing else uses it);
4. creates an empty database called `local`.

When it finishes you see four cards: **Server**, **Connection**, **Databases** and **Server log**.

## 5. Connecting to the database

The **Connection** card shows everything a client needs, each with a **Copy** button:

| Field | Example | Notes |
| --- | --- | --- |
| Host | `127.0.0.1` | The server only listens on this address. |
| Port | `5433` | Unique per site. |
| User | `postgres` | |
| Password | `••••••••••••` | Click **Show password** to reveal it. |
| Database | `local` | Created for you. Add more under **Databases**. |
| URL | `postgresql://postgres:…@127.0.0.1:5433/local` | Everything in one line. |

The second copy button on the card copies a ready-made `.env` line:

```dotenv
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5433/local
```

Use your site's own values; the port and password above are only examples.

### From a terminal

The card shows the exact command, for example:

```bash
psql -h 127.0.0.1 -p 5433 -U postgres local
```

This needs `psql` on your `PATH`. If you don't have it, use the copy that came with the add-on (Linux path shown; see [Where files live](#15-where-files-live) for other systems):

```bash
~/.config/Local/postgresql/versions/17.11.1/bin/psql -h 127.0.0.1 -p 5433 -U postgres local
```

### From an app

**Node.js** (`pg`):

```js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

**Python** (`psycopg`):

```python
import os, psycopg
conn = psycopg.connect(os.environ["DATABASE_URL"])
```

**Laravel** (run with your own PHP that has `pdo_pgsql`, not Local's):

```dotenv
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5433
DB_DATABASE=local
DB_USERNAME=postgres
DB_PASSWORD=YOUR_PASSWORD
```

**GUI tools** (TablePlus, DBeaver, pgAdmin, DataGrip): create a PostgreSQL connection and fill in host, port, user, password and database from the card. Leave SSL off.

## 6. Running the server

The **Server** card shows the status (**Running**, **Stopped**, **Not initialised**, **Binaries missing** or **Unknown**) and the version.

- **Start / Stop / Restart** control the server. Restart is only available while it runs.
- **Start and stop together with this Local site**: on by default. When on, starting the site in Local starts PostgreSQL and stopping the site stops it. Turn it off to run PostgreSQL on its own schedule.
- Quitting Local always stops every PostgreSQL server it started.

### Changing the port

1. Type a new port (1024–65535) next to **Port** in the **Server** card.
2. Click **Change port** and confirm.

The add-on refuses ports that another Local site has or that another program is using. A running server restarts on the new port. If it can't start there, the add-on moves it back to the old port and tells you. Update `DATABASE_URL` in your apps afterwards.

## 7. Managing databases

While the server runs, the **Databases** card lists every database.

- **Create database**: type a name and click the button. Names use lowercase letters, digits and underscores, start with a letter or underscore, and are at most 63 characters (for example `shop_test`).
- **Drop**: deletes a database and all its data after you confirm. The `postgres`, `template0` and `template1` databases are needed by PostgreSQL and can't be dropped.

### Server log

**Server log → Show log** shows the end of the server's log file. Use **Refresh log** to update it. This is the first place to look when the server won't start.

## 8. PostgreSQL versions

The **Installed versions** card lists PostgreSQL **14, 15, 16, 17 and 18**.

- **Download** fetches a version so sites can use it.
- **Remove** deletes a version's files. A version a site still uses shows *In use by a site* and can't be removed.
- Downloaded versions are shared: ten sites on PostgreSQL 17 use one copy of it.
- A site keeps the version it was created with. To move a site to another version, back up its data ([section 10](#10-backups-and-moving-data)), remove PostgreSQL from the site, enable it again with the new version, and restore.

Builds come from [theseus-rs/postgresql-binaries](https://github.com/theseus-rs/postgresql-binaries). PostgreSQL 14 and 15 are not published for Windows on ARM.

## 9. Several sites at once

Every site is fully separate:

| | Site A | Site B | Site C |
| --- | --- | --- | --- |
| Port | 5432 | 5433 | 5434 |
| Data | its own folder | its own folder | its own folder |
| Password | its own | its own | its own |
| Version | can differ | can differ | can differ |

- A site keeps its port even while stopped, so two sites never get the same one.
- Only running sites use memory.
- Actions are queued, so enabling several sites at the same time is safe.
- Deleting one site never touches another site's data.

## 10. Backups and moving data

**Local's Backups tab does not include PostgreSQL data.** The data lives in Local's data folder, not in the site folder. Back it up yourself with `pg_dump`, which comes with the add-on.

Back up (with the server running):

```bash
~/.config/Local/postgresql/versions/17.11.1/bin/pg_dump -h 127.0.0.1 -p 5433 -U postgres -Fc local > local.dump
```

Restore into a database (create it first under **Databases** if needed):

```bash
~/.config/Local/postgresql/versions/17.11.1/bin/pg_restore -h 127.0.0.1 -p 5433 -U postgres -d local --clean local.dump
```

Both ask for the site's password; copy it from the **Connection** card, or set `PGPASSWORD` for the command. Change the version folder and port to match your site.

## 11. Removing PostgreSQL from a site

In **Tools → PostgreSQL**, the **Remove** card has **Remove PostgreSQL**. After you confirm, the add-on stops the server and **permanently deletes all of the site's PostgreSQL data**. Back up first if you need it.

If the server can't be stopped, the add-on keeps the data and tells you, rather than deleting files under a running server.

Deleting the site in Local does the same automatically.

## 12. Uninstalling the add-on

1. Remove PostgreSQL from each site that uses it, or back up the data you want to keep.
2. Quit Local.
3. Either switch the add-on off and remove it under **Add-ons → Installed**, or run `npm run uninstall-addon` in the repository folder.
4. Optionally delete the `postgresql` folder from Local's data folder to reclaim the space used by downloads and data.

## 13. Troubleshooting

| What you see | What to do |
| --- | --- |
| **Add-ons → Installed** is empty, or no **PostgreSQL** under Tools | Quit Local completely and reopen it. Check that the add-on's switch is on. |
| *Port 5432 is already in use by another program* | Another PostgreSQL (or other program) holds the port. Stop it, or use **Change port** to move the site. |
| *Port … is already assigned to another Local site* | Each site needs its own port. Pick a different one. |
| *version `GLIBC_2.36' not found* (Linux) | Update the add-on: newer versions use your system's copies of those libraries automatically. Then click **Enable PostgreSQL** again. |
| *This PostgreSQL build needs a newer Linux* | Your Linux is older than the build supports. Try an older PostgreSQL version, or upgrade to Ubuntu 22.04+ / Debian 12+. |
| *PostgreSQL builds are not available for …* / *not published for your operating system* | That version has no build for your system (e.g. 14 or 15 on Windows ARM). Choose another version. |
| *Checksum mismatch* | The download was damaged. Try again; check proxies or antivirus that rewrite downloads. |
| *PostgreSQL … is no longer installed* | Its version was deleted outside the add-on. Click **Download** for that version under **Installed versions**. |
| The server won't start | Open **Server log → Show log**. Also check `addon.log` (below). |
| *cannot be run as root* | Start Local as your normal user. |

Two logs help with anything else:

- **Server log** — per site, in the panel, or `postgresql/sites/<siteId>/postgres.log`.
- **Add-on log** — `postgresql/addon.log` in Local's data folder: every download, start, stop and error.

When reporting a problem, include the add-on log lines around the error (they never contain passwords).

## 14. Security

- Servers only listen on `127.0.0.1`. Other devices on your network can't connect, and Unix sockets are off.
- Logins use SCRAM-SHA-256 with a random password per site.
- Passwords are stored in `postgresql/config.json` with file mode 0600, and are never written to logs or passed on a command line.
- Downloads use HTTPS only and are checked against the publisher's SHA-256 checksums. This catches damaged downloads; it is not a signature check.

This is a development tool. Don't use it to host production data.

## 15. Where files live

Everything the add-on stores is in a `postgresql` folder inside Local's data folder:

| System | Local's data folder |
| --- | --- |
| Linux | `~/.config/Local/` |
| macOS | `~/Library/Application Support/Local/` |
| Windows | `%APPDATA%\Local\` |

| Path inside `postgresql/` | Contents |
| --- | --- |
| `config.json` | per-site port, user, password, version and auto-start setting |
| `versions/<version>/` | PostgreSQL programs, shared by all sites |
| `versions/<version>/lib-disabled/` | Linux only: bundled libraries replaced by your system's copies |
| `sites/<siteId>/data/` | the site's database cluster |
| `sites/<siteId>/postgres.log` | the site's server log |
| `addon.log` | add-on activity and errors |
