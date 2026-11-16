import axios from 'axios'

// One-tap entry. There is no login form: the app creates a guest account through the
// normal sign-up API (so the token, ownership of rides and everything behind it stay real)
// and remembers it in this browser, so coming back signs in as the same guest.

const BASE = import.meta.env.VITE_BASE_URL
const KEY = (role) => `guest-${role}`            // role: 'user' or 'captain'
const API = { user: 'users', captain: 'captains' }

const random = () => Math.random().toString(36).slice(2, 10)

function newGuest(role, vehicleType) {
  const id = random()
  const guest = {
    email: `guest-${id}@guest.local`,
    password: `pw-${random()}${random()}`,
    firstname: 'Guest',
    lastname: id.slice(0, 4).toUpperCase(),
    vehicleType
  }
  return guest
}

async function register(role, guest) {
  const fullname = { firstname: guest.firstname, lastname: guest.lastname }
  const body = role === 'captain'
    ? {
        fullname, email: guest.email, password: guest.password,
        vehicle: { color: 'white', plate: `GST${Math.floor(Math.random() * 9000 + 1000)}`, capacity: 4, vehicleType: guest.vehicleType }
      }
    : { fullname, email: guest.email, password: guest.password }

  const res = await axios.post(`${BASE}/${API[role]}/register`, body)
  return res.data.token
}

// Signs in as a guest of this role (reusing the one from last time if it is still valid) and
// returns the token. A driver passes the vehicle type: a different type means a new guest.
export async function enterAs(role, vehicleType) {
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(KEY(role))) } catch (e) { /* none */ }

  if (saved && (role !== 'captain' || saved.vehicleType === vehicleType)) {
    try {
      const res = await axios.post(`${BASE}/${API[role]}/login`, { email: saved.email, password: saved.password })
      localStorage.setItem('token', res.data.token)
      return res.data.token
    } catch (e) { /* account gone, make a new one below */ }
  }

  const guest = newGuest(role, vehicleType)
  const token = await register(role, guest)
  localStorage.setItem(KEY(role), JSON.stringify(guest))
  localStorage.setItem('token', token)
  return token
}
