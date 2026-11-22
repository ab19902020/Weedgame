> **Superseded.** This note describes the v0.5 prototype (now in `legacy/`). For v0.6, see `README.md`, `docs/COVERAGE.md` and `docs/SOURCES.md`.

# Berkshire city design · v0.5

GTA IV used Rockstar’s RAGE engine. Contemporary demonstrations describe moving traffic, pedestrians, textured streets, lighting and a navigation display. Rockstar’s designers also discussed building relationships between the protagonist and the people who call him. Green County uses these ideas in service of the brothers’ business: navigating to a buyer, choosing who takes the car, and recognising the district where a deal happens.

- Reference reporting: https://www.gamespot.com/articles/grand-theft-auto-iv-first-look/1100-6171459/
- Developer interview coverage: https://www.gta4.net/news/4044/ign-feature-building-a-brave-new-world/
- Historic England describes the two lodges and Bath-stone carriage arch at the junction of London Road and Wokingham Road. https://historicengland.org.uk/listing/the-list/list-entry/1001641
- Reading Museum identifies the Waterhouse clock tower, terracotta and contrasting local brickwork. https://www.readingmuseum.org.uk/your-visit/our-building-history

The new landmark meshes use the named OSM footprints and approximate dimensions and proportions. Other imported properties use repeated architectural modules. The street HUD chooses the nearest named OSM segment, so close parallel roads and flyovers can give ambiguous results. Map targets currently show a bearing. Ambient people and vehicles use short local segments; connected traffic routing, signal-controlled junctions and crowds with daily schedules are further milestones.

Priorities for subsequent versions: survey street-level views of the parade in Woodley; author distinctive shopfronts and junction approaches; join lanes and pavements across junctions; add vehicle/building collision, signal phases and contextual pedestrian reactions; connect street incidents to persistent crew reputation and police attention. Budget visible actors independently from simulation outside the current neighbourhood. Measure on Android hardware before increasing draw distance.
