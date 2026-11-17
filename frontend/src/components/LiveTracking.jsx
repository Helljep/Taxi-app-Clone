import React, { useEffect, useRef, useState, useContext } from 'react'
import axios from 'axios'
import HeatmapLayer from './HeatmapLayer'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { SocketContext } from '../context/SocketContext'
import { CaptainDataContext } from '../context/CapatainContext'

// Live map built with Leaflet + OpenStreetMap (free, no API key).
//  - blue dot   : this device
//  - orange dot : the captain, when a user is watching their captain arrive
//  - if the person using the app is a captain, their position is also sent
//    to the realtime service so the user can follow along.

const SEND_EVERY = 2000 // ms, no need to flood the server

const LiveTracking = ({ showHeatmap = false, routeFrom = null, routeTo = null }) => {
    const [ map, setMap ] = useState(null)
    const mapDivRef = useRef(null)
    const mapRef = useRef(null)
    const myMarkerRef = useRef(null)
    const captainMarkerRef = useRef(null)
    const lastSentRef = useRef(0)

    const { socket } = useContext(SocketContext)
    const { captain } = useContext(CaptainDataContext)

    // create the map once
    useEffect(() => {
        mapRef.current = L.map(mapDivRef.current, { zoomControl: false }).setView([ 20.5937, 78.9629 ], 5)

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(mapRef.current)
        setMap(mapRef.current)

        return () => {
            setMap(null)
            mapRef.current.remove()
        }
    }, [])

    // follow this device's position
    useEffect(() => {
        if (!navigator.geolocation) return

        const watchId = navigator.geolocation.watchPosition((position) => {
            const { latitude, longitude } = position.coords

            if (!myMarkerRef.current) {
                myMarkerRef.current = L.circleMarker([ latitude, longitude ], {
                    radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1
                }).addTo(mapRef.current)
                mapRef.current.setView([ latitude, longitude ], 15)
            } else {
                myMarkerRef.current.setLatLng([ latitude, longitude ])
            }

            // online captains share their position with the server (offline ones stay private)
            if (captain && captain.status === 'active' && Date.now() - lastSentRef.current > SEND_EVERY) {
                lastSentRef.current = Date.now()
                socket.emit('update-location-captain', {
                    userId: captain._id,
                    location: { ltd: latitude, lng: longitude }
                })
            }
        }, (err) => console.log(err.message), { enableHighAccuracy: true })

        return () => navigator.geolocation.clearWatch(watchId)
    }, [ captain ])

    // draw the driving route between two addresses (when the page asks for one)
    useEffect(() => {
        if (!map || !routeFrom || !routeTo) return

        let line = null
        let cancelled = false

        axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-route`, {
            params: { origin: routeFrom, destination: routeTo },
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(response => {
            if (cancelled) return
            line = L.polyline(response.data.coordinates, { color: '#111827', weight: 5, opacity: 0.8 }).addTo(map)
            map.fitBounds(line.getBounds(), { padding: [ 40, 40 ] })
        }).catch(() => { })

        return () => {
            cancelled = true
            if (line) line.remove()
        }
    }, [ map, routeFrom, routeTo ])

    // the user watches the captain move
    useEffect(() => {
        const handleCaptainLocation = ({ ltd, lng }) => {
            if (!captainMarkerRef.current) {
                captainMarkerRef.current = L.circleMarker([ ltd, lng ], {
                    radius: 9, color: '#fff', weight: 3, fillColor: '#ea580c', fillOpacity: 1
                }).addTo(mapRef.current)
            } else {
                captainMarkerRef.current.setLatLng([ ltd, lng ])
            }
        }

        socket.on('captain-location', handleCaptainLocation)

        return () => socket.off('captain-location', handleCaptainLocation)
    }, [])

    return (
        <>
            <div ref={mapDivRef} style={{ width: '100%', height: '100%', position: 'relative', zIndex: 0 }} />
            {showHeatmap && <HeatmapLayer map={map} />}
        </>
    )
}

export default LiveTracking
