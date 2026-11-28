# Green County radio

`src/radio.js` (ChatGPT's radio wheel). Two stations and off:

* **United Road FM**: 15 songs (`www/radio/*.mp3`): The United Road (2026 Studio Remaster), Feel It, Manchester Is Red (UK Trap Remix), Red Devil (Take Me Home, United Road), National Anthem, Rashford Is Red (Remix), Under My Skin, Manchester Is Red (Remastered), Magic (Remix), Oh Ah Cantona, Still Holding, Manchester Red (Remastered), Red Side Indie Anthem (Remix), The Wolves (Remix), Don't Tap the Glass.
* **Green County Talk**: Theo Von – Childhood Stories (20 minutes, `www/radio/theo-von.m4a`).

The tracks are the owner's, supplied for the game with the rights to include them here; they were copied in as supplied (no re-encoding), with their tags and cover art stripped. Duplicate uploads were left out: the two National Anthem files and the Iron Sky remix / Still Holding were byte-identical, and UNITEDROAD_1 is the same recording as the 2026 Studio Remaster at 128 kbps.

Each track carries a gain in `STATIONS` that brings it to about -14 LUFS (songs) or -15 LUFS (talk), measured with ffmpeg's EBU R128 meter (`ffmpeg -i track -af ebur128=framelog=quiet -f null -`), so changing track or station doesn't jump in volume. To add a track: put the file in `www/radio`, measure it and add `[title, file, gain]` to the station (gain = 10^((-14 - LUFS) / 20)).

Controls: D-pad Left / the Radio button / keyboard U opens the wheel. Cross confirms; Circle closes; D-pad or right stick selects; L1/R1 skip in the wheel. The home radio is on the TV stand: Triangle (Use) nearby. Each car and home keeps its own station; the stations keep their place (track and time) for the session; one audio element.

On the phone the game is served from the APK by `tools/android/src/uk/greencounty/game/Main.java`, which can't serve part of a file (only the TV episodes' .mp4 get range requests), and a media element can't seek in a file served whole. So `GameRadio.load()` reads the playing track into memory (compressed, a few MB; the podcast 19 MB) and plays it from a blob URL: resuming part-way through and the podcast's back-30-seconds work. `tools/android/repack.py` stores the tracks uncompressed in the APK.
