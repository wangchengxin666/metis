# Server file manager

A file manager page that lives in the **left sidebar** and takes the whole centre column. It is not tied to a workspace or a Session, so it works on a blank page with no Session selected.

- **Entry**: the left sidebar's **Server files** row (folder-with-drive glyph). Selecting it opens the page in the centre column; selecting *New Session* returns to the conversation.
- **Browse**: clickable breadcrumbs, a path bar you can type into (Enter jumps straight there), shortcut chips for the configured roots, a folder filter, and a parent-directory button.
- **Preview**: text, images, and PDFs open inline; other files offer a download.
- **Upload**: the toolbar button or drag-and-drop onto the table. Files land in the directory on screen.
- **Download**: per row, or every selected file.
- **Manage**: new folder, rename, delete (single or multi-select). Folders are deleted with their contents, which the confirmation states.

## Configuration

The bundle row's config in `cordis.patch.yml`:

```yaml
- insert:
    - id: file-manager
      name: '@metis/file-manager'
      config:
        roots: []                 # [] = the whole filesystem
        startPath: ''             # first directory; '' = the first root, else /
        allowOutsideRoots: false  # false = stay inside roots once roots are set
        showHidden: false         # show dotfiles
        maxEntries: 5000          # entries per listing
        maxPreviewBytes: 1048576  # text preview cap
        maxBinaryPreviewBytes: 8388608
        maxUploadBytes: 1073741824
```

To restrict the page to a few directories, set e.g. `roots: ['/srv/data', '/home/me/share']`. A path is refused on the Host unless it resolves inside one of those roots (symlinks followed), and the configured roots themselves cannot be renamed or deleted.

## Security

- Every path is validated on the Host, never in the browser.
- `fileManager/*` Remote methods use the normal authenticated `/api` channel.
- The byte routes `/api/file-manager.download`, `/api/file-manager.raw`, and `/api/file-manager.upload` go through the same browser-cookie authentication, Host/Origin trust fence, and owner-only rule as every other `/api` route.
- With the default whole-filesystem setting the page can write anywhere the DSH process user can. Narrow `roots` when the Host is shared.

## Layout of the package

| File | Role |
|---|---|
| `index.js` | Host half: the `fileManager` Cordis service, its Remote methods, and the three byte routes. |
| `client.js` | Browser bundle: a lazy `window.__ModuleLoader__.load({...})` factory that mounts the Remote contribution and registers the sidebar row and the page. |
| `client.js.template` | The factory shell; `client.js` is generated from it. |
| `src/client/*.js` | Page modules: `page.js` (component), `styles.js` (theme-token CSS), `locale.js` (en/zh copy), `contract.js` (wire contract), `icon.js` (sidebar glyph). |
| `scripts/bundle-client.mjs` | Inlines the page modules into the factory and writes `client.js`. |
| `scripts/build.mjs` | Rebuilds `client.js`, then runs every check. |
| `.test/*.mjs` | Checks: Host behaviour, page flows, bundle loading, client apply, Cordis start-up. |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title and description. |

**After editing any `src/client/*.js` file, run `node scripts/build.mjs`** (or just `node scripts/bundle-client.mjs`) so `client.js` picks the change up. Host-side edits apply on reload.

## Limits

- One upload request is capped by `maxUploadBytes` (1 GiB by default).
- Text previews stop at `maxPreviewBytes`; longer files show their beginning.
- Directories are listed one level at a time; there is no recursive search across the server.
- Downloads are ordinary browser downloads; there is no archive-from-selection (each selected file is downloaded separately).