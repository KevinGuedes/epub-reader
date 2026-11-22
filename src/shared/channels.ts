// IPC channel names, shared by main and preload so they cannot drift apart.
export const CH = {
  libraryGetDir: 'library:get-dir',
  libraryChooseDir: 'library:choose-dir',
  libraryScan: 'library:scan',
  libraryScanProgress: 'library:scan-progress',
  libraryList: 'library:list',
  bookRead: 'book:read',
  bookGetProgress: 'book:get-progress',
  bookSaveProgress: 'book:save-progress',
  bookGetLocations: 'book:get-locations',
  bookSaveLocations: 'book:save-locations',
  translateOpen: 'translate:open',
  translateLookup: 'translate:lookup',
  openTakePending: 'open:take-pending',
  openRequested: 'open:requested',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save'
} as const
