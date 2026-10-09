# Releasing and updating the bot

How to change the bot and publish a new version (an automatic GitHub release).

**The golden rule: code first, changelog second, `package.json` last.**
The release starts when `package.json` changes, and it saves the code exactly as it is at that moment.

---

## Quick checklist

- [ ] 1. Change your code files, commit, wait for Vercel **Ready**, and test the bot
- [ ] 2. Choose the new version number
- [ ] 3. Add a section at the top of `CHANGELOG.md`
- [ ] 4. Change `"version"` in `package.json` (**last commit**)
- [ ] 5. Check **Actions** (green ✅) and **Releases** (new version)

---

## Step by step

### 1. Change your code and test it
1. In GitHub, open the file (for example `api/webhook.js`), click the **pencil icon**, make the change, and commit.
2. Write a clear commit message, like `Add Mid/Final menu`, not `Update webhook.js`.
3. Open **Vercel → Deployments** and wait until the newest one says **Ready**.
4. Test the bot in Telegram.

If the change needs a new Sheet column or tab, **do that in the Sheet first**, before you commit the code.

### 2. Choose the version number
The number has three parts: `MAJOR.MINOR.PATCH`.

| Change | Example | New version |
|---|---|---|
| Bug fix or small text change | 1.4.0 → | **1.4.1** |
| New feature | 1.4.0 → | **1.5.0** |
| Big change that needs manual work (new Sheet tabs, renamed variables) | 1.4.0 → | **2.0.0** |

### 3. Write the changelog
Open `CHANGELOG.md`, click the pencil icon, and add a new section at the **top**, just under the `# Changelog` title and the comment:

```
## v1.5.0 – Short title
- What changed
- Another change
- Sheet: add column J "xyz" (only if the Sheet needs a change)
```

Rules:
- The heading must start with `## v` and use **the same number** you will put in `package.json`.
- The text after the dash becomes the **release title**.
- The bullet lines become the **release notes**.
- Keep every older section below it.

Commit this file.

### 4. Change the version (last)
Open `package.json`, click the pencil icon, and change only this line:

```
"version": "1.5.0",
```

Commit. Don't change anything else in that file, especially `"node": "24.x"`.

### 5. Check the release
1. Open the **Actions** tab. The **Auto release** run should show a green ✅ after about 10 seconds.
2. Open the repo's main page and click **Releases**. The new version should be there, with your title and notes.

---

## Examples

**Bug fix (1.4.0 → 1.4.1)**

```
## v1.4.1 – Fix duplicate message
- Fixed the wrong text shown when a file is skipped as a duplicate
```

**New feature (1.4.0 → 1.5.0)**

```
## v1.5.0 – Search command
- New /search command to find a file by name
- Updated help and about texts
```

---

## Good to know

- **Releases don't deploy the bot.** Vercel updates the bot every time you commit to `main`. A release is only a saved, named version.
- **Forgot a file after releasing?** Fix the file, then release a new patch version (for example 1.5.1). Don't reuse a version number: if that version already has a release, the workflow does nothing.
- **Wrong notes?** Open **Releases**, click the release, then **Edit**.
- **No changelog section?** The release is still created, with GitHub's automatic notes.
- **Run it by hand:** **Actions → Auto release → Run workflow** creates a release for the version currently in `package.json`, if it doesn't have one yet.
- **Go back to an older version:** open the release, download **Source code (zip)**, and copy the old files back. For a quick fix of the live bot, use **Instant Rollback** on an older Vercel deployment.
- **Never put tokens or the Google key in files.** They belong only in Vercel's environment variables.

---

## If the release does not appear

| What you see | Fix |
|---|---|
| No new run in **Actions** | Did you change `package.json` on the `main` branch? Is the workflow file at `.github/workflows/release.yml`? |
| Run has a red ❌ | Open the run, open the failed step, and read the red text. Check **Settings → Actions → General → Workflow permissions** is **Read and write** |
| Run is green but no release | That version already has a release. Use a new version number |
| Release has automatic notes, not yours | The `CHANGELOG.md` heading doesn't match. It must be exactly `## v1.5.0` or `## v1.5.0 – title`, with the same number as `package.json` |
