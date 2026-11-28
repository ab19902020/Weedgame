# Builds

From v0.39.0 the APK is about 127 MB (121 MiB): the TV's episodes (South Park and All or Something, about 35 MiB,
`www/assets/home/`) are packed into it so they play offline. That is over GitHub's 100 MB limit for a file, so the
APK is no longer kept in this folder; it is handed over directly with each release.

To build it yourself from the previous signed APK (no Android SDK needed):

    npm run build
    python3 tools/android/repack.py previous.apk . unsigned.apk 0.43.0 46
    java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
         --add-exports java.base/sun.security.util=ALL-UNNAMED -cp tools/android:apksig-2.3.0.jar \
         Sign keystore password alias unsigned.apk Green-County-0.43.0-dev.apk

(`Sign.java` is in `tools/android`; compile it with apksig 2.3.0 on the classpath. The development key keeps
updates installing over v0.22 and later.) `Green-County-Brothers.apk` is the older standalone build.
