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
│   └── realtime/  3005    Socket.io server, pushes events to browsers
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

You need Node 20+, MongoDB and RabbitMQ running locally. In each of `gateway`, `services/user`,
`services/captain`, `services/ride`, `services/maps`, `services/realtime`:

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
