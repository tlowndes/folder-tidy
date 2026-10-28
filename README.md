# Folder Tidy

A Windows app that keeps Downloads and Documents tidy. It watches those folders and moves new files to the place you choose, based on rules you set. Every move can be undone.

## How it works

- **Rules** are checked top to bottom. The first enabled rule that matches a file's extension (and optional name text) wins. A rule with no destination does nothing.
- **Waiting:** a file is moved only after it has finished downloading and a short delay (5 minutes by default).
- **Undo:** each move is logged for 30 days. Undo puts the file back where it was.
- **Dry run:** shows what would move without moving anything.

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

## Layout

- `main.js`: Electron main process, tray, IPC
- `preload.js`: the only bridge between the UI and the main process
- `lib/rules.js`: rule matching
- `lib/organiser.js`: plan, move and undo a file
- `lib/watcher.js`: watches the folders
- `lib/mover.js`, `lib/history.js`, `lib/config.js`, `lib/safety.js`
- `src/`: the UI

Settings and history are stored in `%APPDATA%\folder-tidy\`.

## Licence

MIT
