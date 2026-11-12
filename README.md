# Folder Tidy

A Windows app that keeps Downloads and Documents tidy. It watches those folders and moves new files to the place you choose, based on rules you set. Only files sitting straight in a watched folder are moved; subfolders are always left alone. Every move can be undone.

## How it works

- **Rules** are checked top to bottom. The first enabled rule that matches a file wins. A rule matches on file type (or **Any type**), and can also need the name to contain some text, the file to be bigger than so many MB, or older than so many days (the age check only matters in Check, as new downloads are always new). A rule with no destination does nothing. "Any type" rules never take shortcuts (`.lnk`, `.url`) or `.ini` files.
- **Rename on move:** a rule can tidy the name (`Brief - Copy (2).PDF` becomes `Brief.pdf`) and put the date in front (`2026-11-03 Brief.pdf`). Undo puts the old name back.
- **Watched folders:** Downloads and Documents by default. Add any other folder in Settings, or the Desktop with one click.
- **This week:** files sorted each day, by rule and by folder, space cleared, and a rough guess at the time saved.
- **Clean:** two halves, both previewed first. **Junk** sizes up temp files, browser caches (Chrome, Edge, Brave, Firefox), crash reports and the thumbnail cache, and clears the ones you tick. These are deleted for good, as they rebuild themselves; anything changed in the last day is kept. It also shows the Recycle Bin and can empty it (after asking). **Big files** lists the largest files in your user folder (or a folder you choose) and how much space each top-level folder takes. Tick any and they go to the Recycle Bin.
- **Waiting:** a file is moved only after it has finished downloading and a short delay (5 minutes by default).
- **Undo:** each move is logged for 30 days. Undo puts the file back where it was.
- **Dry run:** shows what would move without moving anything.
- **Check now:** looks at the files already sitting in your watched folders (top level only, not subfolders). It lists what would move, gives a reason for every file it would leave alone (no rule, rule turned off, no folder set, in use, still downloading and so on), and suggests rules for file types nothing matches. Nothing moves until you press Move. Also in the tray menu.
- **Old clutter:** Check now also lists exact duplicates, installers older than 30 days and downloads that stalled over a week ago, in the watched folders and the Installers folder (top level only). Tick what to bin and it goes to the Recycle Bin, so you can restore it.
- **Leave alone:** any file in Check can be marked "Leave alone", so it is never moved or offered for the bin. "Stop ignoring" undoes it.
- **Dated subfolders:** a rule can also sort into year or year-and-month subfolders (e.g. `Pictures\2026\10`), based on the file's date.
- **Drag and drop:** drag a file from Explorer onto a rule to add its type, or onto "Try a file name" to see where it would go.
- **Tray:** shows how many files were tidied today.
- **First-run setup:** new installs get a three-step welcome (folders, destinations, dry run or live) that ends with a Check. Run it again from Settings.
- **Updates:** the installed app checks GitHub Releases every few hours, downloads new versions in the background and tells you when one is ready: click the notification to restart and install it. Turn this off in Settings, or use **Check for updates** there or in the tray menu. The portable exe (`Folder-Tidy-Portable-x.y.z.exe`) doesn't update itself, so use the Setup exe.
- **Archive (cold storage):** pick the folders your projects live in (each subfolder is one project) and an archive folder on an external drive, NAS or synced cloud folder. Once a day (10am by default) Folder Tidy looks for projects with nothing changed inside for 30 days (changeable) and sends a notification. Nothing moves until you approve it on the Archive page. Each project is zipped into the archive folder, read back and checked file by file against the original, then the original goes to the Recycle Bin. **Restore** unzips it back where it was. Also in the tray menu.
- **Notifications:** by default you get one daily summary (6pm, changeable) with what moved and how many files need a look, instead of a pop-up per file. If the PC is off at that time, it arrives when Folder Tidy next starts. You can switch to a pop-up for each move, or turn them off.

## Safety

- Folders starting with `@` or `.` are never touched.
- AppData, OneDrive, Proton Drive, Windows and Program Files are never touched.
- Sorting never deletes anything. Files are moved, and a name clash gets a number (`invoice (2).pdf`).
- `desktop.ini`, `Thumbs.db` and Office `~$` lock files are never moved.
- The only things deleted for good are the junk files on the Clean page, and only inside the known temp and cache folders, never following links, and never anything changed in the last day. Emptying the Recycle Bin asks first.
- Partial downloads (`.crdownload`, `.part`, `.tmp`) are left alone until finished.
- Existing files are not moved when the app starts. Only new files are.
- Archiving never deletes a project outright. The zip is checked against every original file first, and the project is skipped if anything in it changed while zipping, the drive is missing or short of space, or it has links to other folders. Only then does the original go to the Recycle Bin. A restore never overwrites a folder that's already there.

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
- `lib/archive.js`: cold storage: find idle projects, zip, verify, bin and restore
- `lib/naming.js`: tidy names and date prefixes
- `lib/stats.js`: the This week numbers
- `lib/cleaner.js`, `lib/recyclebin.js`: the Clean page
- `lib/mover.js`, `lib/history.js`, `lib/config.js`, `lib/safety.js`
- `src/`: the UI

Settings and history are stored in `%APPDATA%\folder-tidy\`.

## Licence

MIT
