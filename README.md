# Remilia Shoutbox (Pictochat Replacer)

Remilia Shoutbox replaces the inactive "Pictochat" tab on https://remilia.com with a live, Supabase-powered chatbox.

## Installation

### 1. Download the extension

- Go to the repository's main page on GitHub.
- Click "Code" → "Download ZIP".
- Extract the ZIP file somewhere on your computer.

### 2. Open the Extensions page in Chrome

- Open Google Chrome and go to:
  chrome://extensions/
- Turn on "Developer mode" (toggle in the top-right corner).

### 3. Load the unpacked extension

- Click "Load unpacked".
- Select the folder you just extracted that contains manifest.json.

### 4. Use the extension

- Go to your Remilia profile (for example: https://remilia.com/~otto).
- Click the "Pictochat" tab and the shoutbox will load automatically.
- Or click the browser toolbar icon on any site to open the shoutbox popup and chat on the go.

## Folder structure

remilia-shoutbox/
├── manifest.json
├── content.js
├── shoutboxCore.js
├── popup.html
├── popup.js
├── popup.css
├── style.css
├── supabase.min.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png

## Notes

- The Pictochat replacement still runs on https://remilia.com/*, and the popup works anywhere.
- It connects to a public Supabase backend for real-time chat.
- No personal or browsing data is collected.
