export type PickerCallbackData = {
  action: string;
  docs?: Array<{ id?: string }>;
};

export type GooglePickerView = {
  setMimeTypes: (types: string) => void;
  setOwnedByMe?: (ownedByMe: boolean) => void;
  setEnableDrives?: (enabled: boolean) => void;
  setIncludeFolders?: (enabled: boolean) => void;
};

export type GooglePickerBuilder = {
  setTitle: (title: string) => GooglePickerBuilder;
  addView: (view: GooglePickerView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (appId: string) => GooglePickerBuilder;
  setOrigin: (origin: string) => GooglePickerBuilder;
  setCallback: (
    callback: (data: PickerCallbackData) => void,
  ) => GooglePickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};

export type GooglePickerNamespace = {
  picker: {
    ViewId: { SPREADSHEETS: string };
    Action: { PICKED: string };
    DocsView: new (viewId: string) => GooglePickerView;
    PickerBuilder: new () => GooglePickerBuilder;
  };
};

export type GoogleApiWindow = Window & {
  gapi?: { load: (name: string, options: { callback: () => void }) => void };
  google?: GooglePickerNamespace;
};

type PickerBrowserWindow = {
  location: Pick<Location, "origin" | "href">;
};

export function buildReportsGoogleSheetPicker({
  builder,
  title,
  view,
  accessToken,
  developerKey,
  pickerAppId,
  callback,
  browserWindow = window,
}: {
  builder: GooglePickerBuilder;
  title: string;
  view: GooglePickerView;
  accessToken: string;
  developerKey: string;
  pickerAppId: string;
  callback: (data: PickerCallbackData) => void;
  browserWindow?: PickerBrowserWindow;
}) {
  return builder
    .setTitle(title)
    .addView(view)
    .setOAuthToken(accessToken)
    .setDeveloperKey(developerKey)
    .setAppId(pickerAppId)
    .setOrigin(browserWindow.location.origin)
    .setCallback(callback)
    .build();
}
