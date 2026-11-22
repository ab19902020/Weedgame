# Green County
Open www/index.html. Use WASD/arrows or the touch stick. Visit a site and tap Site. Choose a destination to set a bearing. Your parked vehicle is blue. Saves use browser local storage.
For an Android debug APK with Node 22, Android Studio, JDK 21 and Android SDK 35 installed: run npm install, npm run android, then cd android and run ./gradlew assembleDebug. The APK is in app/build/outputs/apk/debug/.
Map geometry © OpenStreetMap contributors, licensed under ODbL 1.0 (https://www.openstreetmap.org/copyright). www/map.js is the distributed derived database. import_map.py refreshes the corridor extracts. Buildings and roads are from OSM. Gameplay sites are fictional. Early prototype permits free movement across geometry.

## Developer handoff · Brothers v0.3

Read CLAUDE-PROMPT.md for the next milestone. The current signed development APK is in builds/. The shipped APK uses the Android WebView activity and manifest in native/. The Capacitor command above creates an alternative Android project and does not reproduce that native wrapper or its signing identity. The original signing key is excluded. A different key cannot update an installed copy in place.

For a quick browser run, use `python3 -m http.server 8080 --directory www` from this directory and open localhost:8080. Use the touch stick or keyboard arrows. Phone opens orders and crew management, Swap changes brother, and Site opens local actions.

The seven PNGs in concept-art/ are visual references. 01 shows the progression from lock-up to warehouse. 02–04 explore chase, territory and bulk-sale mechanics in the earlier comic style. 05–07 are later art-direction alternatives.

For GitHub, extract the archive and commit the contents of Green-County/ as your project root.
