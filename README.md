# Folder Tidy

A Windows app that keeps Downloads and Documents tidy. It watches those folders and moves new files to the place you choose, based on rules you set. Only files sitting straight in a watched folder are moved; subfolders are always left alone. Every move can be undone.

## How it works

- **Rules** are checked top to bottom. The first enabled rule that matches a file's extension (and optional name text) wins. A rule with no destination does nothing.
- **Waiting:** a file is moved only after it has finished downloading and a short delay (5 minutes by default).
- **Undo:** each move is logged for 30 days. Undo puts the file back where it was.
- **Dry run:** shows what would move without moving anything.
- **Check now:** looks at the files already sitting in your watched folders (top level only, not subfolders). It lists what would move, gives a reason for every file it would leave alone (no rule, rule turned off, no folder set, in use, still downloading and so on), and suggests rules for file types nothing matches. Nothing moves until you press Move. Also in the tray menu.
- **Updates:** the installed app checks GitHub Releases every few hours, downloads new versions in the background and installs them when it next restarts. Turn this off in Settings, or use **Check for updates** there or in the tray menu. The portable exe doesn't update itself.
- **Notifications:** by default you get one daily summary (6pm, changeable) with what moved and how many files need a look, instead of a pop-up per file. If the PC is off at that time, it arrives when Folder Tidy next starts. You can switch to a pop-up for each move, or turn them off.

## Safety

- Folders starting with `@` or `.` are never touched.
- AppData, OneDrive, Proton Drive, Windows and Program Files are never touched.
- Nothing is deleted. Files are moved, and a name clash gets a number (`invoice (2).pdf`).
- Partial downloads (`.crdownload`, `.part`, `.tmp`) are left alone until finished.
- Existing files are not moved when the app starts. Only new files are.

## Develop

```bash
npm install
npm test      # unit tests
npm start     # run the app
npm run dist  # build the Windows installer and portable exe
```

## Release

Bump `version` in `package.json`, merge, then push a matching tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions builds the installer and portable exe on Windows and publishes them to [Releases](https://github.com/tlowndes/folder-tidy/releases).

## Layout

- `main.js`: Electron main process, tray, IPC
- `preload.js`: the only bridge between the UI and the main process
- `lib/rules.js`: rule matching
- `lib/organiser.js`: plan, move and undo a file
- `lib/watcher.js`: watches the folders
- `lib/scan.js`: Check now, reasons and rule suggestions
- `lib/mover.js`, `lib/history.js`, `lib/config.js`, `lib/safety.js`
- `src/`: the UI

Settings and history are stored in `%APPDATA%\folder-tidy\`.

## Licence

MIT
