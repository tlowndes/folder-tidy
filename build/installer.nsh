; Windows caches icons by file path. Folder Tidy installs to the same path every
; time, so a copy installed before the app had its own icon keeps showing the
; Electron one. Telling the shell that associations changed makes it reload them.
!macro customInstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
