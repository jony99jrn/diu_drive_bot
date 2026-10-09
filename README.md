# DIU Class Materials Bot

Telegram bot **@diu_drive_bot** that keeps lecture slides, PDFs and other class materials in one place, organised by department, semester, course and exam (Mid / Final).

Students browse with buttons: **Department → Semester → Course → Mid / Final / All files → file**.
Admins upload by sending files to the bot (or posting them in a private storage channel).

Version: **1.4.0**

---

## How it works

- Files stay on Telegram's servers. The bot saves only each file's `file_id` and its details in a **Google Sheet**, and sends files with that ID.
- The bot runs as a **Vercel** serverless function. Telegram calls it through a webhook.
- Every file the bot saves is also copied into a private **storage channel** as a backup.

```
Telegram ⇄ Vercel (api/webhook.js) ⇄ Google Sheets (index) 
                         └→ private channel (backup copies)
```

---

## Features

**For students**
- Menu: department → semester → course → **📘 Mid / 📗 Final / 📚 All files** → file
- **Send all** for the list being viewed
- `/report your message` to report a missing file (limited to 3 reports per hour)

**For admins**
- Upload with a caption, with buttons, or in `/batch` mode
- Channel mode: post files in the private channel with a caption
- Duplicate check (same semester, course, exam and title is skipped)
- Reports saved in a Sheet tab, with a "done" checkbox
- All times in Bangladesh time (GMT+6)

---

## Commands

| Command | Who | What it does |
|---|---|---|
| `/start` | everyone | Welcome message and department menu |
| `/help` | everyone | How to use the bot (admins also see upload help) |
| `/about` | everyone | About the bot |
| `/report your message` | everyone | Report a missing file to the admins |
| `/id` | everyone | Shows your own Telegram ID |
| `/batch` | admins | Upload several files into one course and exam |
| `/done` | admins | Turn batch mode off |
| `/cancel` | admins | Cancel an unfinished upload or batch |

Menu commands to set in @BotFather (`/setcommands`):

```
start - Open the menu
help - How to use the bot
about - About the bot
report - Report a missing file
```

---

## Uploading files (admins)

Only Telegram IDs in `ADMIN_IDS` can upload.

**1. One file with a caption (fastest)**

```
CSE | Summer 2026 | CSE 113 | Mid | Lecture 1
```

Parts: `department | semester | course | exam | title`.
Exam is `Mid`, `Final`, or `-` for material that belongs to the whole course (shown under All files only).
A 4-part caption without the exam still works. The bot then asks Mid or Final with buttons.

**2. One file without a caption**
Send the file and follow the buttons: department → semester → course → exam → title. Use **➕ New** to type a value that is not listed. For the title, tap the suggested file name or type your own.

**3. Several files (`/batch`)**
1. Send `/batch` in the chat with the bot and choose department, semester, course and exam once.
2. Send your files (4 to 5 at a time works well).
3. For each file the bot asks for a title: tap **Use: file name**, or reply to its question with your own title.
4. Send `/done` when finished.

Do not send several files together without `/batch`, because the questions clash.

**4. From the private channel**
Post the file with the full caption. Results and questions come to the first admin in `ADMIN_IDS` by message. Commands such as `/batch` only work in the private chat with the bot.

**Deleting a file:** delete its row in the `files` tab (right-click the row number → Delete row), and delete its post in the channel. Deleting only the row removes it from the bot's menu.

---

## Google Sheet structure

Create these tabs with these exact names and header rows.

**`files`**

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| dept | semester | course | title | type | file_id | added_on | kind | exam |

Column `I` holds `Mid` or `Final`. A blank value means the file shows only under All files.

**`pending`** – temporary notebook used while uploading

| A | B |
|---|---|
| user_id | data |

**`limits`** – `/report` rate limit (cleans itself)

| A | B | C |
|---|---|---|
| user_id | count | window_start |

**`reports`** – log of every `/report`

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| date | user_id | name | username | message | done |

The bot adds the checkbox in column `F` for each new report.

---

## Environment variables (Vercel)

| Name | Value |
|---|---|
| `BOT_TOKEN` | Token from @BotFather |
| `SHEET_ID` | The long ID in the Google Sheet URL |
| `GOOGLE_CLIENT_EMAIL` | `client_email` from the service account key |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the service account key |
| `ADMIN_IDS` | Admin Telegram IDs, separated by commas (your own ID first) |
| `WEBHOOK_SECRET` | Any password you make up (letters, numbers, `_`, `-`) |
| `CHANNEL_ID` | ID of the private storage channel (starts with `-100`) |

After adding or changing variables, **redeploy** in Vercel.

**Never commit the Google JSON key or any token to GitHub.**

---

## Setup

1. **Bot:** create it with @BotFather (`/newbot`) and copy the token.
2. **Sheet:** create the Google Sheet with the tabs above and copy its ID.
3. **Google Cloud:** create a project, enable the **Google Sheets API**, create a **service account**, download its JSON key, and share the Sheet with its `client_email` as **Editor**.
4. **GitHub:** push this project to a repository.
5. **Vercel:** import the repository (framework: Other), add the environment variables, and deploy.
6. **Webhook:** open this link in a browser with your own values:

   ```
   https://api.telegram.org/botBOT_TOKEN/setWebhook?url=https://YOUR-PROJECT.vercel.app/api/webhook&secret_token=WEBHOOK_SECRET&allowed_updates=["message","callback_query","channel_post"]
   ```

   It should answer `"ok":true`.
7. **Channel:** create a private channel, add the bot as an **admin**, and put the channel's ID in `CHANNEL_ID`.
8. **Admins:** to add one, ask them to send `/id` to the bot, add their number to `ADMIN_IDS`, and redeploy.

Opening `https://YOUR-PROJECT.vercel.app/api/webhook` in a browser should show "running ✅".

---

## Project structure

```
api/
  webhook.js     Main bot logic: menus, uploads, /batch, /report, channel mode
lib/
  sheets.js      Google Sheets access (files, pending, limits, reports) and caching
  telegram.js    Telegram API helpers
  util.js        Caption parsing, name cleaning, file type detection, sorting
package.json     Project info (Node 24)
vercel.json      Function settings (60 second limit)
.gitignore       Keeps secrets and node_modules out of GitHub
CHANGELOG.md     What changed in each version (used for release notes)
RELEASING.md     Step-by-step guide to updating the bot and releasing
.github/workflows/release.yml   Creates a GitHub release when the version changes
```

---

## Limits and notes

- **Telegram:** about 1 message per second to one chat. "Send all" waits 0.4 seconds between files.
- **Buttons:** each button's hidden data is limited to 64 bytes, so keep names short (e.g. `CSE`, `Summer 2026`, `CSE 113`).
- **Menu size:** a list shows at most 90 file buttons.
- **Google Sheets:** about 60 reads per minute per service account. The bot caches the Sheet for 60 seconds, so changes in the Sheet can take up to a minute to appear.
- **Vercel Hobby plan:** for personal, non-commercial use, with a monthly limit on function calls that is plenty for a class-sized bot.
- **Bulk uploads:** upload roughly 10 files per minute in `/batch` mode, and re-send any that fail. The duplicate check makes re-sending safe.

---

## Troubleshooting

| Problem | What to check |
|---|---|
| Bot does not reply | Vercel → Deployments (latest must say **Ready**), then Vercel → Logs |
| Log says `Unexpected end of input` | A file on GitHub was cut off when pasting. Re-upload it and compare line counts |
| Build fails on Node version | `package.json` must say `"node": "24.x"` |
| `/start` works but uploads fail | Sheet shared with the service account as Editor? Tab names exact? |
| Webhook error 401 | `WEBHOOK_SECRET` must match the `secret_token` in the `setWebhook` link |
| Files not copied to the channel | `CHANNEL_ID` correct and bot is a channel admin? Look for `copyMessage failed` in the logs |
| Menu button shows few commands | Send all command lines to @BotFather in one message |

---

## Updating the bot and releasing a version

1. Edit the file on GitHub (pencil icon), replace its contents, and commit.
2. Vercel redeploys on its own. Wait for **Ready**, then test the bot.
3. To publish a new version: add a section to `CHANGELOG.md`, then change the version in `package.json` **last**. A GitHub release is created automatically.

Full guide with examples: **[RELEASING.md](RELEASING.md)**. Version history: **[CHANGELOG.md](CHANGELOG.md)**.

If something breaks, open the file's **History** on GitHub to restore an older version, or use **Instant Rollback** on an older Vercel deployment.

---

Made by Jony Roy (GitHub: [jony99jrn](https://github.com/jony99jrn)).
