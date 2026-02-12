# Test Extension for Event Sync Engine

Browser extension (Manifest V2) to test the sync engine with the real `storage.sync` API.

## Setup

1. **Build the extension:**
   ```bash
   npm run build:extension
   ```

2. **Load in Firefox:**
   - Open `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `test-extension/manifest.json`

3. **Load in Chrome/Edge:**
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `test-extension` folder

## First Use

1. Click the extension icon to open the page
2. Enter a **unique Device ID** (e.g., "laptop", "desktop", "phone")
3. The extension initializes and you're ready to create todos

⚠️ **Important**: Each browser/device must have a different Device ID. If you reuse the same ID after clearing local data, you'll get a warning.

## Testing Multi-Device Sync

1. **Setup second browser:**
   - Create a new Firefox/Chrome profile
   - Enable sync in both profiles (sign in with same account)
   - Load the extension in both
   - Use different Device IDs (e.g., "device-A" and "device-B")

2. **Test sync:**
   - Create a todo on device A
   - Wait ~10 seconds (storage.sync has delay)
   - Or force sync manually in Firefox: `about:sync-log` → "Sync Now"
   - Click "Manual Sync" on device B
   - The todo should appear

3. **Verify debug info:**
   - Check "All Devices" → you should see 2 devices
   - Check "Events" → you should see events from both
   - Verify events are ordered by HLC time
