Musicly — Local Music Player PWA
Musicly is a local-first Progressive Web App starter for Android/mobile browsers. It uses an original green-and-black music-note icon and English UI.
Included
Add individual audio files or choose a folder (browser support varies).
Store audio blobs in IndexedDB on the device; no music upload/server.
Tracks, Albums, Folders, Playlists, Singers and Composers views.
Singer/Composer selections combine matching tracks into one list, across albums/films.
Filename-based fallback metadata and basic ID3 text-tag reading (title, artist, album, composer).
Now Playing screen with artwork placeholder, progress, 10-second seek back/forward, previous/next, play/pause, shuffle and repeat.
Equalizer (bass/mid/treble), optional stereo-panning effect, configurable crossfade.
Playlist sharing as a text track list using the Android share sheet (WhatsApp can be selected).
PWA manifest, custom icons, service worker app-shell cache, Media Session metadata/actions.
Run locally
PWA installation and service workers require HTTPS or localhost. A quick local server:
python -m http.server 8000
Open http://localhost:8000 on the same device for testing. For phone installation, deploy the extracted files to an HTTPS host such as GitHub Pages.
Android install
Upload the contents of this folder to the root of a GitHub repository.
In GitHub: Settings → Pages → Deploy from a branch → main → /(root).
Open the HTTPS Pages URL in Android Chrome.
Use Chrome menu → Install app (or Add to Home screen).
The installed icon should use Musicly's custom icon assets.
Important platform limitations
A PWA cannot automatically change Android battery optimisation, notification permissions, or background execution settings. The user may need to allow background activity / notifications in Android settings.
Media Session can provide lock-screen and notification metadata/controls on supported Android/Chrome combinations. Exact layout and available buttons are controlled by the OS.
PWA background playback is not guaranteed to behave exactly like a native Spotify app on every device. Browser/OS memory management and battery policies can stop a web app.
Browsers do not expose unrestricted access to the whole music filesystem. Folder selection uses the browser's directory picker where available; users may need to reselect folders after browser data is cleared.
Album artwork extraction from embedded MP3 artwork is not implemented in this starter; it currently uses a placeholder artwork. Metadata support is basic ID3 text tags. A later upgrade can add robust ID3/APIC artwork parsing and editable tag screens.
Crossfade uses two HTML audio decks and Web Audio gain ramps. Some mobile browsers may restrict simultaneous playback or AudioContext until a user gesture; test on target devices.
8D-style toggle is a stereo panning motion effect, not a true spatial-audio mastering process.
Shared playlists contain track names only. The recipient needs the same audio files locally; audio files are not sent.
Equalizer and crossfade require Web Audio API support and a user playback gesture.
Data and privacy
Tracks are stored in the browser's IndexedDB. Clearing site data/browser storage can remove the local library. Keep original audio files backed up elsewhere.
Project status
This is a detailed functional starter, not a finished native Android app. Test with your phone and audio collection before relying on it as a daily player.
