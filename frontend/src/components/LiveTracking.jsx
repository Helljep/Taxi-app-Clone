import React, { useEffect, useRef, useContext } from 'react'
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

const LiveTracking = () => {
    const mapDivRef = useRef(null)
    const mapRef = useRef(null)
    const myMarkerRef = useRef(null)
    const captainMarkerRef = useRef(null)
    const lastSentRef = useRef(0)

    const { socket } = useContext(SocketContext)
    const { captain } = useContext(CaptainDataContext)

    // create the map once
    useEffect(() => {
        mapRef.current = L.map(mapDivRef.current).setView([ 20.5937, 78.9629 ], 5)

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(mapRef.current)

        return () => {
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

            // captains share their position with the server
            if (captain && Date.now() - lastSentRef.current > SEND_EVERY) {
                lastSentRef.current = Date.now()
                socket.emit('update-location-captain', {
                    userId: captain._id,
                    location: { ltd: latitude, lng: longitude }
                })
            }
        }, (err) => console.log(err.message), { enableHighAccuracy: true })

        return () => navigator.geolocation.clearWatch(watchId)
    }, [ captain ])

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

    return <div ref={mapDivRef} style={{ width: '100%', height: '100%', position: 'relative', zIndex: 0 }} />
}

export default LiveTracking
