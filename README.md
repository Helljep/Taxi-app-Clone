# Uber Clone (microservices + live tracking)

A ride-hailing app where a **user** books a ride and a nearby **captain** (driver) accepts it,
and the user then watches the captain move on a live map.

It combines three learning sources into one project:

| Part | What it teaches | Where it lives here |
|------|-----------------|---------------------|
| Uber clone (`ankurdotio/uber-video`) | Full app: login, fares, OTP, ride flow, React screens | `frontend/` and the business logic inside `services/` |
| Microservices (`ankurdotio/micro-services`) | How big systems split into services, use a gateway and a message queue | `gateway/`, `services/*`, RabbitMQ in `docker-compose.yml` |
| Live tracking video (Sheryians, Socket.io + Leaflet) | Real-time location on a map | `services/realtime/` and `frontend/src/components/LiveTracking.jsx` |

## Folder structure

```
uber-clone/
├── frontend/              React + Vite + Tailwind UI
├── gateway/               single entry point (port 3000), forwards to the services
├── services/
│   ├── user/      3001    user accounts and login
│   ├── captain/   3002    captain accounts, vehicle, saved location, "who is nearby"
│   ├── ride/      3003    fares, creating / accepting / starting / ending rides
│   ├── maps/      3004    address search, distance and time (OpenStreetMap, free)
│   ├── realtime/  3005    Socket.io server, pushes events to browsers
│   └── heatmap/   3006    H3 cell counters in Redis, driver heatmap, surge multiplier
├── loadtest/              surge simulator: fake drivers and riders, checks nothing is lost or double-booked
├── docker-compose.yml     starts all of it plus MongoDB, RabbitMQ and Redis
├── docker-compose.loadtest.yml   settings for the surge test (2 ride-service copies, limits lifted)
└── Dockerfile.service     one Dockerfile reused by every backend service
```

Every backend service uses the same layout, so once you understand one you understand all:
`routes → controllers → services → models`.

## How a ride works (the story to tell)

```
 User browser                                              Captain browser
      |                                                          |
      | 1. POST /rides/create                                    |
      v                                                          |
  [ Gateway :3000 ] ---> [ Ride service ]                        |
                            | a. asks Maps service for distance -> fare
                            | b. saves the ride in MongoDB
                            | c. offers the ride to the nearest free captain (Dispatch)
                            | d. puts a "new-ride" message for that captain on RabbitMQ
                            v
                        [ RabbitMQ queue: ride-events ]
                            |
                            v
                     [ Realtime service ] --- socket.io "new-ride" ---> pop-up on captain's screen
                                                                         |
      <---- "ride-confirmed" (with OTP) <---- same path <---- 2. captain taps Accept
      <---- "ride-started"              <---- same path <---- 3. captain types the OTP
      <---- "captain-location" every ~2s <--- captain's phone GPS -------- (live tracking)
      <---- "ride-ended"                <---- same path <---- 4. captain taps Finish
```

## Features beyond the basic ride flow

**Live driver heatmap and surge pricing.** Both maps show hexagons: green for free captains, orange to red
where there are more ride requests than captains. Surge shows on the vehicle list and is included in the fare.

```
captain GPS ping -> [Realtime] --"supply-events" queue--> [Heatmap service] -> Redis counters per H3 cell
ride request     -> [Ride service] --POST /demand-------> [Heatmap service]
[Ride service] <---- GET /surge (cell + 6 neighbours) ---- [Heatmap service]
[Heatmap service] --"ride-events" queue (every 3s, only if changed)--> [Realtime] --> all browsers
```

- The map is cut into H3 hexagons (about 0.7 km2), so "how many captains are here" is a counter lookup.
- Redis keeps a sorted set per hexagon. A captain who loses signal ages out after 30 s and a ride request
  counts for 5 minutes, so counts can't drift. Captains on a ride are not counted as free.
- Surge is `ride requests / free captains` in the pickup hexagon and its 6 neighbours, from 1x up to 3x.

| Feature | Where | How it works |
|---|---|---|
| Batch dispatch | `ride/services/dispatch.js` | Rides wait in a Redis queue. Every 300 ms a batch is matched at once with the Hungarian algorithm (smallest total pickup time). Each driver gets one offer at a time, 15 s to accept; on Ignore or timeout the ride goes back in the queue. See "Surviving a traffic spike" below. |
| ETA | `ride/services/dispatch.js` | "N mins away" per vehicle type comes from the Redis driver index (straight-line distance with a road factor). The trip fare uses OSRM, with a straight-line fallback. |
| Scalable realtime | `realtime` service | Socket.io uses a Redis adapter and "which captain is on which ride" lives in Redis, so several realtime servers can run side by side. |
| Reliable queues | each service's `rabbit.js` | A failing message is retried 3 times, then moved to `<queue>.dead` instead of being lost. Connections reconnect on their own. |
| Rate limiting and monitoring | `gateway/middlewares` | Per-IP limits (overall, login, ride requests), `GET /metrics`, `GET /health` and an `x-request-id` on every request. |
| Online / offline | captain home | Offline captains get no offers and leave the heatmap. |
| Cancel, history, ratings | `ride` service | Riders cancel before the trip starts, captains after accepting. Both see their trips. Riders rate 1 to 5. |
| Payments (demo) | `user` + `ride` services | Cash or wallet. The wallet is charged once, atomically, when the ride ends; if it is short the rider pays cash. Top-ups are free test credit, there is no payment provider. |
| Abuse rules | `realtime/services/gps.js`, `ride/services/ride.service.js` | GPS jumps faster than 200 km/h are ignored, a rider who cancels 3 rides in 30 minutes is blocked for a while, and each rider and captain can have one open ride. |

Settings are environment variables: `RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_MIN`, `RIDE_RATE_LIMIT_PER_MIN`,
`OFFER_TIMEOUT_MS` and `ACCESS_LOG=off`.

Not built: Kafka (RabbitMQ does the job at this size), machine-learning pricing and fraud detection, sharding
and multi-region, and a real payment provider. Known limits: the gateway's rate-limit counts are per gateway;
one Redis (no cluster); events go out after the database write, so a crash between the two can drop a push
message (the app should re-read its ride on reconnect, as the simulator does).

## Surviving a traffic spike (the part this project is about)

A "Diwali sale" for rides: thousands of people ask for a ride in the same minute, and drivers are limited.
The system must not crash, must not lose a ride, and must never give one driver two rides.

```
 rider app
    | POST /rides/create   (Idempotency-Key, so a retry never makes a second ride)
    v
 [Gateway] --> [Ride service, 1..N copies]
                 1. ADMISSION CONTROL   queue full or too many in flight?  -> 503 + Retry-After   (load shedding)
                 2. auth (cached 60 s), fare (route cache + circuit breaker + straight-line fallback), surge (cached 2 s)
                 3. save ride in MongoDB, answer 201 straight away
                 4. put the ride id in the Redis queue  ----------------------------+
                                                                                     |
 driver phone --GPS every 2 s--> [Realtime] --GEOADD--> Redis GEO + 30 s liveness    |
                                                              |                      |
                 every 300 ms, any copy:  pop a batch  <------+----------------------+
                   GEOSEARCH nearest drivers for every ride (one pipeline)
                   drop drivers who are gone / on a ride / already holding an offer
                   cost matrix ride x driver = pickup minutes  ->  Hungarian algorithm
                   claim each driver with SET NX  ->  save offer  ->  RabbitMQ  ->  driver's screen
                 no answer in 15 s / declined / no driver nearby  -> back in the queue (up to 60 s)
```

What each piece does for you:

| Problem in a spike | Answer | Where |
|---|---|---|
| Far more requests than the system can serve | Admission control: queue cap and in-flight cap, turn the rest away fast with `Retry-After`. Clients retry with random delay (jitter). | `ride/services/admission.js` |
| A retry must not create a second ride | `Idempotency-Key` header, plus a unique index in MongoDB (one open ride per rider) | `ride.controller.js`, `ride.model.js` |
| Finding the nearest drivers among thousands | Redis GEO index updated on every GPS ping; a driver silent for 30 s drops out on its own | `realtime/services/driverIndex.js`, `ride/services/driverIndex.js` |
| Greedy matching wastes driver time | Batch matching with the Hungarian algorithm, O(n^2 m). Rides that waited longer are matched first when drivers are scarce. | `ride/services/hungarian.js`, `dispatch.js` |
| Two riders getting the same driver | One offer per driver via Redis `SET NX`, and an offer can be accepted only by the driver who holds it (`findOneAndUpdate` on `currentOffer`) | `driverIndex.js`, `ride.service.js` |
| Free map servers are slow or down | Cache for addresses and routes, circuit breaker, straight-line (haversine) fallback | `maps.client.js`, `breaker.js`, `geo.js` |
| A service copy crashes | Queue and offers live in Redis, not memory. A repair job (every 15 s) compares Redis with MongoDB and restores rides that fell out of the queue. Accepting a ride twice is safe (idempotent). | `dispatch.js` `reconcile()` |
| Prices | Surge = ride requests / free drivers in the pickup H3 hexagon and its 6 neighbours, clamped 1x to 3x | `heatmap` service |

**The mathematics in one place.** Distance: haversine. Space: H3 hexagons (heatmap, surge) and Redis GEO (nearest drivers).
Matching: minimise the sum of pickup times over a whole batch (assignment problem, Hungarian algorithm). Leaving a ride
unmatched costs `1000 + seconds waited`, so older rides win scarce drivers. `node loadtest/matching-demo.js` compares it with
greedy "nearest driver first" on random cities:

| riders | drivers | greedy total | batch total | saved |
|---|---|---|---|---|
| 10 | 12 | 68.4 min | 61.3 min | 10.4 % |
| 50 | 60 | 189.7 min | 156.2 min | 17.7 % |
| 100 | 120 | 252.3 min | 204.4 min | 19.0 % |
| 200 | 300 | 255.4 min | 223.7 min | 12.4 % |

### Measured results (one laptop, Docker, simulated traffic)

300 simulated drivers (real websockets, GPS every 2 s, 8 % ignore and 8 % decline offers) and 1500 simulated riders.
5 requests/s, then a **150 requests/s spike for 40 s**, then calm again. Two ride-service copies, queue cap 400
(set low on purpose so shedding is visible). Full reports are in `loadtest/results/`.

| | Spike | Spike + one ride-service copy killed mid-spike (`docker kill`) |
|---|---|---|
| Ride requests | 1828 | 1984 |
| Turned away with 503 and retried later | 3085 | 5568 |
| Rides completed | 1715 | 1625 |
| Cancelled (no driver within 45 s) | 27 | 71 |
| **Rides lost or stuck** | **0** | **0** |
| **Driver given two rides** | **0** | **0** |
| Unexpected 5xx errors | 0 | 0 (109 gateway 502s while the copy was down, all retried) |
| Matching batch | ~34 rides in ~56 ms | ~38 rides in ~57 ms |
| Peak rides waiting | 440 | not sampled |

How to read this honestly: it is one machine and simulated phones, so the numbers show behaviour (nothing lost, nothing
crashes, the queue absorbs the spike), not production capacity. Riders waited a median of about 20 s for a driver because
300 drivers cannot serve 150 requests per second; that is supply, not the engine. In the crash run, 2 rides were created
whose reply was lost with the dead copy; they still reached a final state on the server. Two bugs were found by this test
and fixed: `assertQueue` ran on every RabbitMQ publish (batches took about 1300 ms, now about 60 ms), and accepting a
ride twice after a lost response returned an error instead of the same ride.

### Run the surge test

```bash
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up --build -d
cd loadtest && npm install
DRIVERS=300 RIDERS=1500 node setup.js          # creates fake accounts through the real sign-up API
SPIKE_RPS=150 SPIKE_S=40 node run.js           # prints the report and checks the invariants
```

Open http://localhost:3000/dashboard while it runs: queue depth, requests/s, offers/s, requests turned away, free
drivers, time to first offer, batch size. To see crash recovery, run `docker kill uber-clone-ride-1` during the spike
and `docker start uber-clone-ride-1` a few seconds later. The fake accounts use `@loadtest.dev` emails; remove them with
`db.users.deleteMany({email:/@loadtest.dev$/})` in database `uber-users` and the same for `captains` in `uber-captains`.

## Why it is built this way ("how big companies handle traffic")

- **Gateway**: the browser knows one address. Services can move or scale without the frontend changing.
- **Separate services, separate databases**: if rides get busy, only the ride service needs more copies.
  The user service is untouched.
- **RabbitMQ between services**: the ride service doesn't wait for sockets or notifications. It drops a
  message and moves on, so a traffic spike queues up instead of crashing things.
- **Throttled location saving**: a captain's phone reports position every ~2 seconds. That is shown live
  to the user straight away, but only saved to MongoDB every 5 seconds (through a queue). This is the
  difference between 30 writes a minute and 12 per captain.
- **Geo index**: captain positions are stored as GeoJSON with a `2dsphere` index, so MongoDB can find
  nearby captains quickly instead of scanning everyone.
- **Socket rooms**: each person joins a room (`user:<id>` / `captain:<id>`), so messages are addressed by
  id and no socket ids need to be stored in the database.
- **Token-checked sockets**: a browser must send its login token to join its room, so nobody can listen
  to someone else's ride.

## Running it

### Option A: Docker (easiest)

```bash
docker compose up --build
```

Open http://localhost:5173. RabbitMQ dashboard: http://localhost:15672 (guest / guest).

### Option B: without Docker

You need Node 20+, MongoDB, RabbitMQ and Redis running locally. In each of `gateway`, `services/user`,
`services/captain`, `services/ride`, `services/maps`, `services/realtime`, `services/heatmap`:

```bash
cp .env.example .env
npm install
npm start
```

Then in `frontend`:

```bash
cp .env.example .env
npm install
npm run dev
```

## Trying it out

Live tracking uses the browser's GPS, so test with two browser windows (one normal, one incognito):

1. Window A: sign up as a **captain** (vehicle type must match what the user will pick) and stay on the home screen.
2. Window B: sign up as a **user**, type a pickup and destination (pick from the suggestions), choose the same vehicle type, confirm.
3. Window A: a ride pop-up appears. Accept, then enter the 6-digit OTP shown on the user's screen.
4. Both windows now show the map. Finish the ride from the captain side.

The captain must be online and within 3 km of the pickup. Use a pickup near your own location, because the captain's
position comes from the browser's GPS. In Chrome DevTools you can fake a location under
*Sensors* if you want to test two different places.

## Changes from the original repos

- Google Maps replaced by **Leaflet + OpenStreetMap** (map), **Nominatim** (address search) and **OSRM**
  (distance/time). All free, no API key, no card.
- The single backend was split into the microservices layout, using the `micro-services` gateway and RabbitMQ helper.
- Captains are found with a real geo query on a `2dsphere` index and filtered by vehicle type.
- Fixes to the original code: `blackListToken` file name casing (breaks on Linux), `moto` vs `motorcycle`
  mismatch, a stray character in `endRide`, socket listeners registered on every render, and the captain
  logout using a different token key and env name.
- Autocomplete is debounced and cached, because the free search service allows about one request a second.

## Known limits (good to mention when presenting)

- The free OpenStreetMap services (Nominatim, OSRM demo server) are for light use only. For production you
  would self-host them or pay for a provider.
- Payments are not implemented (the original had unused payment fields; they were dropped).
- The frontend runs in Vite dev mode inside Docker. For production run `npm run build` and serve `dist/`.

## Credits

Built on tutorial code from `ankurdotio/uber-video`, `ankurdotio/micro-services` and the Sheryians Coding
School real-time tracking video, combined and extended.
