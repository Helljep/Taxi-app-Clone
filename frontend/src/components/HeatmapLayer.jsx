import { useEffect, useContext } from 'react'
import L from 'leaflet'
import axios from 'axios'
import { cellToBoundary } from 'h3-js'
import { SocketContext } from '../context/SocketContext'

// Draws the live driver heatmap on a Leaflet map as hexagons.
//  - green  : free captains here (darker = more captains)
//  - orange to red : busy area, more ride requests than captains (surge pricing)
// The server only sends cell ids and counts (a few KB); the hexagon shape is worked out here.
// The first picture comes from one HTTP call, after that the server pushes
// a fresh one over the socket every few seconds, only when something changed.

function colourFor(cell) {
    if (cell.surge > 1) {
        // 1.1x is light orange, 3x is deep red
        const t = Math.min((cell.surge - 1) / 2, 1)
        return { color: '#dc2626', fillColor: '#ea580c', fillOpacity: 0.25 + t * 0.45 }
    }
    const t = Math.min(cell.drivers / 5, 1)
    return { color: '#16a34a', fillColor: '#22c55e', fillOpacity: 0.15 + t * 0.45 }
}

const HeatmapLayer = ({ map }) => {
    const { socket } = useContext(SocketContext)

    useEffect(() => {
        if (!map) return

        const layer = L.layerGroup().addTo(map)

        const draw = (cells) => {
            layer.clearLayers()
            for (const cell of cells) {
                L.polygon(cellToBoundary(cell.cell), { weight: 1, ...colourFor(cell) })
                    .bindTooltip(
                        `${cell.drivers} free captain${cell.drivers === 1 ? '' : 's'} · ` +
                        `${cell.demand} request${cell.demand === 1 ? '' : 's'}` +
                        (cell.surge > 1 ? ` · ${cell.surge}x surge` : '')
                    )
                    .addTo(layer)
            }
        }

        axios.get(`${import.meta.env.VITE_BASE_URL}/heatmap`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(res => draw(res.data.cells)).catch(() => { })

        const handleUpdate = (data) => draw(data.cells)
        socket.on('heatmap-update', handleUpdate)

        return () => {
            socket.off('heatmap-update', handleUpdate)
            layer.remove()
        }
    }, [ map ])

    return null
}

export default HeatmapLayer
