
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
        ? (captain.rating.sum / captain.rating.count).toFixed(2)
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
            <div className='flex items-center gap-3'>
                <div className='flex h-12 w-12 items-center justify-center rounded-full bg-black text-lg font-semibold uppercase text-white'>
                    {captain.fullname.firstname?.[ 0 ]}
                </div>
                <div className='min-w-0 flex-1'>
                    <h4 className='truncate text-lg font-semibold capitalize'>{captain.fullname.firstname + " " + (captain.fullname.lastname || '')}</h4>
                    <p className='flex items-center gap-1 text-sm text-[#6b6b6b]'>
                        <i className="ri-star-fill text-black"></i> {ratingAverage}
                        <span className='mx-1'>·</span>
                        <span className='capitalize'>{captain.vehicle?.vehicleType}</span>
                    </p>
                </div>
                <div className='text-right'>
                    <p className='text-2xl font-bold'>₹{captain.earnings || 0}</p>
                    <p className='text-xs text-[#6b6b6b]'>Earnings</p>
                </div>
            </div>

            <div className='mt-4 grid grid-cols-3 gap-2'>
                <div className='rounded-xl bg-[#f6f6f6] p-3 text-center'>
                    <p className='text-xl font-bold'>{captain.ridesCompleted || 0}</p>
                    <p className='text-xs text-[#6b6b6b]'>Trips</p>
                </div>
                <div className='rounded-xl bg-[#f6f6f6] p-3 text-center'>
                    <p className='text-xl font-bold'>{ratingAverage}</p>
                    <p className='text-xs text-[#6b6b6b]'>Rating</p>
                </div>
                <Link to='/captain-history' className='rounded-xl bg-[#f6f6f6] p-3 text-center'>
                    <p className='text-xl font-bold'><i className="ri-time-line"></i></p>
                    <p className='text-xs text-[#6b6b6b]'>History</p>
                </Link>
            </div>

            <div className='mt-4 flex items-center gap-2 text-sm font-medium'>
                <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-[#05944f]' : 'bg-[#a0a0a0]'}`} />
                {online ? "You're online. Finding you trips…" : "You're offline"}
            </div>
            <button onClick={toggleOnline} className={`btn mt-2 ${online ? 'btn-grey' : 'btn-black'}`}>
                {online ? 'Go offline' : 'Go online'}
            </button>
        </div>
    )
}

export default CaptainDetails
