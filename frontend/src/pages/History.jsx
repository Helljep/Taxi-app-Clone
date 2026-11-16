import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import 'remixicon/fonts/remixicon.css'

// Trip history for a rider (role="user") or a captain (role="captain").
const History = ({ role }) => {
    const [ rides, setRides ] = useState(null)
    const [ error, setError ] = useState('')

    const home = role === 'captain' ? '/captain-home' : '/home'
    const path = role === 'captain' ? 'captain-history' : 'history'

    useEffect(() => {
        axios.get(`${import.meta.env.VITE_BASE_URL}/rides/${path}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        })
            .then(response => setRides(response.data))
            .catch(() => setError('Could not load your trips'))
    }, [])

    return (
        <div className='min-h-screen bg-gray-50'>
            <div className='flex items-center gap-4 p-5 bg-white shadow-sm'>
                <Link to={home} className='h-10 w-10 bg-gray-100 flex items-center justify-center rounded-full'>
                    <i className="text-lg ri-arrow-left-line"></i>
                </Link>
                <h1 className='text-2xl font-semibold'>Your trips</h1>
            </div>

            <div className='p-4 flex flex-col gap-3'>
                {error && <p className='text-red-600'>{error}</p>}
                {!rides && !error && <p className='text-gray-500'>Loading...</p>}
                {rides && rides.length === 0 && <p className='text-gray-500'>No trips yet.</p>}

                {rides?.map(ride => (
                    <div key={ride._id} className='bg-white rounded-xl p-4 shadow-sm'>
                        <div className='flex justify-between items-start'>
                            <p className='text-sm text-gray-500'>{new Date(ride.createdAt).toLocaleString()}</p>
                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${ride.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {ride.status === 'cancelled' && ride.cancelledBy ? `cancelled by ${ride.cancelledBy}` : ride.status}
                            </span>
                        </div>
                        <p className='mt-2 text-sm'><i className="ri-map-pin-user-fill"></i> {ride.pickup}</p>
                        <p className='mt-1 text-sm'><i className="ri-map-pin-2-fill"></i> {ride.destination}</p>
                        <div className='mt-3 flex justify-between items-center'>
                            <span className='font-semibold'>₹{ride.fare}
                                {ride.surgeMultiplier > 1 && <span className='ml-1 text-xs text-orange-600'>{ride.surgeMultiplier}x surge</span>}
                            </span>
                            <span className='text-sm text-gray-600'>
                                {ride.status === 'completed' && `${ride.paymentMethod} · ${ride.paymentStatus === 'cash-due' ? 'cash due' : ride.paymentStatus}`}
                                {ride.rating?.score && ` · ${'★'.repeat(ride.rating.score)}`}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default History
