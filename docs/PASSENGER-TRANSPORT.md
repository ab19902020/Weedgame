# Berkshire passenger transport

Use Road Atlas to route to a station. The purple dashed line follows the active railway. At street zoom, teal squares mark bus stops with onward service. Approach on foot and use the interaction button (Triangle on DualShock). Wait at the platform or stop until the arriving service is stationary and Board appears. Use the button while moving to request the next stop, or at a stop to leave immediately. The HUD reports the next call.

The local shuttle serves Reading, Earley, Winnersh Triangle, Winnersh and Wokingham in both directions. Its centreline is extracted from the existing OSM-derived tile rails and rail bridge decks. The checked-in alignment is reproducible with `node tools/transit/rail.mjs`. This corridor ends at Wokingham because the current tile graph cannot supply a continuous onward path to Bracknell. Station platform meshes are approximations. The line uses a single reversible shuttle, simulated running and dwell times and a roughly half-hour return cycle in real play time. It is independent of the accelerated lighting clock.

Station reference coordinates come from [UK Railway Stations](https://github.com/davwheat/uk-railway-stations). Station order and typical journey intervals were checked against [South Western Railway timetable 2](https://www.southwesternrailway.com/-/media/files/plan-my-journey/timetables/may-2026/ptt02-may-2026.pdf). Map data attribution is in SOURCES.md.

Bus rides use the traffic simulation's bus objects, directed routes, scheduled stop indices and dwell state. Stop calls are inferred where the imported route lacks explicit calls. A bus section needs at least two calls to offer an onward passenger journey. Passenger journeys and onboard NPCs are session state.
