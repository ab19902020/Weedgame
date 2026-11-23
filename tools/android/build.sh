#!/usr/bin/env bash
# Builds and signs the Android development APK without Gradle (aapt2 + javac + d8 + apksigner).
# Needs: JDK 17+, Android SDK with platforms;android-35 and build-tools;35.0.0 (ANDROID_HOME).
# Signing: KEYSTORE (default ~/.android/greencounty-dev.keystore, created if missing), KS_PASS.
set -euo pipefail
cd "$(dirname "$0")/../.."
SDK=${ANDROID_HOME:-/opt/android-sdk}; BT=$SDK/build-tools/35.0.0; JAR=$SDK/platforms/android-35/android.jar
VERSION=$(node -p "require('./package.json').version"); CODE=${VERSION_CODE:-6}
W=build/android; rm -rf $W; mkdir -p $W/classes $W/assets/www $W/res/mipmap-xxxhdpi $W/res/mipmap-xxhdpi $W/res/mipmap-xhdpi $W/res/mipmap-hdpi $W/res/mipmap-mdpi
node tools/build.mjs
python3 tools/android/icon.py $W/res
cp -r www/index.html www/app.js www/worker.js www/hud.css www/characters www/world $W/assets/www/
cp tools/android/assets-extra/migrate.html $W/assets/
$BT/aapt2 compile --dir $W/res -o $W/res.zip
$BT/aapt2 link -o $W/base.apk -I $JAR --manifest tools/android/AndroidManifest.xml $W/res.zip -A $W/assets \
  --min-sdk-version 26 --target-sdk-version 35 --version-code $CODE --version-name $VERSION -0 bin -0 png
javac -nowarn --release 11 -classpath $JAR -d $W/classes tools/android/src/uk/greencounty/game/Main.java
$BT/d8 --release --min-api 26 --lib $JAR --output $W $(find $W/classes -name '*.class')
(cd $W && zip -q base.apk classes.dex)
$BT/zipalign -p -f 4 $W/base.apk $W/aligned.apk
KEYSTORE=${KEYSTORE:-$HOME/.android/greencounty-dev.keystore}; KS_PASS=${KS_PASS:-greencounty-dev}
if [ ! -f "$KEYSTORE" ]; then mkdir -p "$(dirname "$KEYSTORE")"; keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias gcdev -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Green County Development, O=Green County, C=GB" >/dev/null; fi
mkdir -p builds
OUT=builds/Green-County-$VERSION-dev.apk
$BT/apksigner sign --ks "$KEYSTORE" --ks-pass pass:$KS_PASS --ks-key-alias gcdev --out $OUT $W/aligned.apk
$BT/apksigner verify --print-certs $OUT | head -4
ls -la $OUT
