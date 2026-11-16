
import React, { useContext } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { CaptainDataContext } from '../context/CapatainContext'
import { SocketContext } from '../context/SocketContext'

const CaptainDetails = () => {

    const { captain, setCaptain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)

    const online = captain.status === 'active'
    const ratingAverage = captain.rating?.count
        ? (captain.rating.sum / captain.rating.count).toFixed(1)
        : 'New'

    // go online / offline. Offline captains get no ride offers and leave the heatmap.
    async function toggleOnline() {
        const status = online ? 'inactive' : 'active'

        try {
            const response = await axios.patch(`${import.meta.env.VITE_BASE_URL}/captains/status`, { status }, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            })
            setCaptain(response.data.captain)

            if (status === 'inactive') {
                socket.emit('go-offline')
            }
        } catch (err) {
            console.log(err.message)
        }
    }

    return (
        <div>
            <div className='flex items-center justify-between'>
                <div className='flex items-center justify-start gap-3'>
                    <img className='h-10 w-10 rounded-full object-cover' src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRdlMd7stpWUCmjpfRjUsQ72xSWikidbgaI1w&s" alt="" />
                    <h4 className='text-lg font-medium capitalize'>{captain.fullname.firstname + " " + (captain.fullname.lastname || '')}</h4>
                </div>
                <div>
                    <h4 className='text-xl font-semibold'>₹{captain.earnings || 0}</h4>
                    <p className='text-sm text-gray-600'>Earned</p>
                </div>
            </div>
            <div className='flex p-3 mt-6 bg-gray-100 rounded-xl justify-center gap-5 items-start'>
                <div className='text-center'>
                    <i className="text-3xl mb-2 font-thin ri-star-line"></i>
                    <h5 className='text-lg font-medium'>{ratingAverage}</h5>
                    <p className='text-sm text-gray-600'>Rating</p>
                </div>
                <div className='text-center'>
                    <i className="text-3xl mb-2 font-thin ri-roadster-line"></i>
                    <h5 className='text-lg font-medium'>{captain.ridesCompleted || 0}</h5>
                    <p className='text-sm text-gray-600'>Rides</p>
                </div>
                <Link to='/captain-history' className='text-center'>
                    <i className="text-3xl mb-2 font-thin ri-booklet-line"></i>
                    <h5 className='text-lg font-medium'>Trips</h5>
                    <p className='text-sm text-gray-600'>History</p>
                </Link>
            </div>
            <button
                onClick={toggleOnline}
                className={`w-full mt-4 p-3 rounded-lg font-semibold text-white ${online ? 'bg-green-600' : 'bg-gray-500'}`}>
                {online ? 'You are online (tap to go offline)' : 'You are offline (tap to go online)'}
            </button>
        </div>
    )
}

export default CaptainDetails
