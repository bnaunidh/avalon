# Cuemath Browser

A small, focused desktop browser for online tutoring. It opens **Cuemath — or any
website** — in a normal browser view, with study tools built into the window:

- **Address bar + back / forward / reload / home** — browse anywhere.
- **Scientific calculator** (🧮) with keyboard input and history.
- **AI math tutor** (🎓) — type a question, attach a photo, or **Capture screen** to
  screenshot the current page; it explains how to solve the problem step by step.
  Runs on the **Claude API with your own key** (stored locally on your Mac).
- **Quick text** (⚡) — saved snippets you trigger with `Alt + key`.
- **Focus mode** (⛶) — hide all the chrome and show only the page. `Esc` exits.
- **Local audio / camera controls** (your side only):
  - 🔊 **Mute page sound** — silences the site on your own speakers.
  - 🎙️ **Mic** / 🎥 **Camera** — turn *your own* mic/camera off in a call. This
    disables your outgoing tracks (the call stays connected but sends silence / a
    blank frame — exactly like pressing mute). It never touches anyone else's feed.
  - 🙈 **Hide video** — stops video rendering on *your* screen only.

## Run it (any OS, for development)

```bash
cd study-browser
npm install
npm start
```

## Build the macOS `.dmg`

A macOS `.dmg` **must be built on a Mac** — Apple's packaging tools only run on
macOS, so this step won't work on Linux/Windows.

```bash
cd study-browser
npm install
npm run dist
```

The installer is written to `study-browser/dist/Cuemath Browser-1.0.0.dmg`.

### First launch (unsigned app)

The app isn't code-signed, so macOS Gatekeeper will warn on first open. Either:

- Right-click the app in Applications → **Open** → **Open**, or
- `xattr -cr "/Applications/Cuemath Browser.app"` then open normally.

To ship it signed/notarized, add your Apple Developer credentials to the
`build.mac` section of `package.json` (see electron-builder docs) and set
`identity` to your signing identity.

## The AI tutor key

1. Get a key at <https://console.anthropic.com/settings/keys>.
2. Open the app → ⚙️ **Settings** → paste the key → **Save**.

The key is stored in your app data folder
(`~/Library/Application Support/Cuemath Browser/settings.json`) and is only ever
sent to Anthropic's API when you ask the tutor a question.

## Notes

- Logins (including Cuemath) persist between launches in a dedicated browser
  profile, so you don't sign in every time.
- Everything except the tutor and the embedded site works offline.
