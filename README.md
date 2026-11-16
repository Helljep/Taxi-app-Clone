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
├── docker-compose.yml     starts all of it plus MongoDB and RabbitMQ
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
                            | c. asks Captain service "who is within 2 km?"
                            | d. puts a "new-ride" message on RabbitMQ
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

## Live driver heatmap and surge pricing

Both the user map and the captain map show hexagons: **green** = free captains, **orange/red** = more
ride requests than captains (surge). Hover a hexagon for its numbers. Surge shows up on the vehicle
panel and is included in the fare.

```
captain GPS ping -> [Realtime] --"supply-events" queue--> [Heatmap service] -> Redis counters per H3 cell
ride request     -> [Ride service] --POST /demand-------> [Heatmap service]
[Ride service] <---- GET /surge (cell + 6 neighbours) ---- [Heatmap service]
[Heatmap service] --"ride-events" queue (every 3s, only if changed)--> [Realtime] --> all browsers
```

- **H3 cells** (`h3-js`, resolution 8, about 0.7 km2): a lat/lng becomes one cell id, so "how many captains
  are here" is a counter lookup, not a geo search over every captain.
- **Redis** keeps a sorted set per cell (`supply:<cell>`, `demand:<cell>`). A captain who disconnects or
  loses signal ages out after 30 s and a ride request counts for 5 minutes, so counts can't drift.
  Captains on a ride are removed from supply.
- **Surge** = `ride requests / free captains` in the pickup cell and its 6 neighbours, never below 1x and
  capped at 3x (see `services/heatmap/services/surge.js`).
- **Queue instead of Kafka**: RabbitMQ is already in this project and does the same job at this size.
- **Sharding** (not built): at Uber scale you would split Redis by city or by the first digits of the
  H3 cell id, so each shard owns a region.
- Test it: run a captain window, wait about 5 s, a green hexagon appears. Then request rides from a user
  window with no captain nearby and watch the hexagon turn orange and the fare rise.
- Tests: `cd services/heatmap && npm test` (uses an in-memory Redis).

## Production-style features

| Feature | Where | How it works |
|---|---|---|
| **Smart dispatch** | `services/ride/services/dispatch.js` | A new ride is offered to ONE captain at a time, best first. Captains are ranked by real driving time (OSRM) to the pickup, busy ones are skipped. The captain has 15 s (`OFFER_TIMEOUT_MS`) to accept; on Ignore or timeout the next captain gets it; after 5 offers or nobody left, the ride is cancelled and the rider is told. |
| **Real ETA + route** | `services/maps` (`/get-etas`, `/get-route`) | "N mins away" per vehicle type is the driving time of the nearest free captain. The route is drawn on the map. If OSRM is down, ETAs fall back to straight-line distance at 30 km/h. |
| **Scale-out realtime** | `services/realtime` | Socket.io Redis adapter, so any number of realtime servers share rooms. "Which captain is on which ride" lives in Redis, not in server memory. |
| **Reliable queues** | each service's `rabbit.js` | A failing message is retried 3 times with a growing delay, then parked in `<queue>.dead` (a dead-letter queue) instead of being lost. Connections reconnect and re-subscribe automatically. |
| **Rate limiting** | `gateway/app.js` | 600 requests/min per IP overall, 20/min on login and register, 15/min on ride requests. Limits are env vars (`RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_MIN`, `RIDE_RATE_LIMIT_PER_MIN`). |
| **Monitoring** | `gateway/app.js` | `GET /metrics` (Prometheus format: latency per service and status), `GET /health`, and an `x-request-id` on every request that is passed to the services and printed in the gateway log. |
| **Online / offline** | captain home screen | Offline captains get no offers, send no GPS and leave the heatmap. |
| **Cancel, history, ratings** | ride service | Riders cancel before the trip starts, captains after accepting; both sides are told live. Trip history for both. Riders rate 1 to 5 after the ride; captains show their average. |
| **Payments (demo)** | user + ride service | Pay by cash or wallet. Wallet money is deducted atomically when the ride ends (never double-spent, never charged twice). If the wallet is short the rider pays cash. No real payment provider: top-ups are free test credit. |
| **Fraud rules** | `realtime/services/fraud.js`, `ride/services/fraud.js` | GPS pings that teleport faster than 200 km/h are ignored. A rider who cancels 3 rides in 30 minutes is blocked for a while. One open ride per rider and per captain. |

Not built (and why): Kafka (RabbitMQ does the job at this size), machine-learning pricing / ETA / fraud
(these rules are the simple version), sharding and multi-region (they need several machines to mean anything;
the Redis keys are per H3 cell on purpose, so they can be split by region later), a real payment provider.

Known limits at scale: the dispatch countdowns live in the ride service's memory (several ride servers would
need them in Redis or in delayed queue messages), and the gateway rate-limit counters are per gateway
(several gateways would share them through Redis).

### Load test

`loadtest/loadtest.js` simulates many captains streaming GPS and many riders watching the heatmap, and
prints pings per second, `/heatmap` latency and live pushes. It does not create rides, because that calls
the free Nominatim/OSRM services, which do not allow load testing.

```bash
RATE_LIMIT_PER_MIN=10000000 AUTH_RATE_LIMIT_PER_MIN=10000000 ACCESS_LOG=off docker compose up --build
```

```bash
cd loadtest && npm install && node loadtest.js --captains 300 --riders 50 --seconds 60
```

Watch the RabbitMQ dashboard while it runs: a queue whose depth keeps growing is a consumer that cannot
keep up. To see scaling, run more realtime copies (`docker compose up --scale realtime=3` needs the
port mapping removed and a load balancer in front, so this is a good exercise, not a one-liner).

Unit tests: `npm test` inside `services/heatmap`, `services/ride` and `services/realtime`.

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

The captain must be within 2 km of the pickup. Use a pickup near your own location, because the captain's
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
- The realtime service keeps "which captain is on which ride" in memory. With several realtime copies you
  would move this to Redis and use the Socket.io Redis adapter.
- Payments are not implemented (the original had unused payment fields; they were dropped).
- The frontend runs in Vite dev mode inside Docker. For production run `npm run build` and serve `dist/`.

## Credits

Built on tutorial code from `ankurdotio/uber-video`, `ankurdotio/micro-services` and the Sheryians Coding
School real-time tracking video, combined and extended.
