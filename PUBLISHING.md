## GitHub Publishing Checklist

Use this checklist before making the repository public.

### 1. Secrets

- Rotate every API key that was ever tested in this project.
- Treat old local exports such as `smart-bookmark-*.json` as sensitive. They may contain API keys and sync credentials.
- Do not commit `.env*`, `*.local*`, `*.secret*`, or exported backup JSON files.

### 2. Git History

- Review commit history before publishing. A removed secret is still public if it exists in old commits.
- Rewrite history if you ever committed a real API key, password, token, or credential file.
- The existing history also contains personal email addresses. Switch to a GitHub `noreply` email before future commits.

### 3. Release Surface

- Keep disabled features disabled unless you are ready to maintain them securely.
- Re-check `manifest.json` before release and remove any development-only integration points.
- Confirm that exported settings/import files are not present in the repo root.

### 4. Final Verification

- Run a final secret scan on the full repository and Git history.
- Confirm the extension works with your own local API key configuration only.
- Check that no build output or local backup data is staged before pushing.
