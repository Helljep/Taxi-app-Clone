import React, { useState } from 'react'
import axios from 'axios'
import { Link, useLocation } from 'react-router-dom' // Added useLocation
import { useEffect, useContext } from 'react'
import { SocketContext } from '../context/SocketContext'
import { useNavigate } from 'react-router-dom'
import LiveTracking from '../components/LiveTracking'
import RouteTimeline from '../components/RouteTimeline'
import { RIDES } from '../components/VehiclePanel'

const Riding = () => {
    const location = useLocation()
    const { ride } = location.state || {} // Retrieve ride data
    const { socket } = useContext(SocketContext)
    const navigate = useNavigate()
    const [ endedRide, setEndedRide ] = useState(null)
    const [ stars, setStars ] = useState(0)

    useEffect(() => {
        // the ride is over: show the receipt and ask for a rating before going home
        const handleRideEnded = (finished) => {
            setEndedRide(finished)
        }

        socket.on("ride-ended", handleRideEnded)

        return () => socket.off("ride-ended", handleRideEnded)
    }, [])

    async function submitRating() {
        try {
            if (stars > 0) {
                await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/rate`, {
                    rideId: endedRide._id,
                    rating: stars
                }, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                })
            }
        } catch (err) {
            console.log(err.response?.data?.message || err.message)
        }
        navigate('/home')
    }


    const captain = ride?.captain
    const vehicle = captain?.vehicle
    const kind = RIDES[ vehicle?.vehicleType ] || RIDES.car

    return (
        <div className='h-screen'>
            {endedRide && (
                <div className='fixed inset-0 z-[1000] flex items-end bg-black/60'>
                    <div className='sheet w-full px-4 pb-8 pt-3'>
                        <div className='handle' />
                        <h3 className='text-[26px] font-bold'>You've arrived</h3>
                        <p className='mt-1 text-4xl font-bold'>₹{endedRide.fare}</p>
                        <p className='mt-1 text-sm text-[#6b6b6b]'>{endedRide.paymentStatus === 'cash-due'
                            ? 'Your wallet was short, please pay your driver the rest in cash'
                            : endedRide.paymentMethod === 'wallet' ? 'Paid from your wallet' : 'Pay your driver in cash'}</p>
                        <div className='my-5 border-t border-[#eeeeee] pt-4'>
                            <p className='text-base font-medium'>Rate your ride with <span className='capitalize'>{endedRide.captain?.fullname?.firstname}</span></p>
                            <div className='mt-2 flex gap-1 text-4xl'>
                                {[ 1, 2, 3, 4, 5 ].map(n => (
                                    <button key={n} onClick={() => setStars(n)} className={n <= stars ? 'text-black' : 'text-[#d6d6d6]'}>★</button>
                                ))}
                            </div>
                        </div>
                        <button onClick={submitRating} className='btn btn-black'>
                            {stars > 0 ? 'Submit' : 'Skip'}
                        </button>
                    </div>
                </div>
            )}
            <Link to='/home' className='fixed left-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-md'>
                <i className="text-xl ri-home-5-line"></i>
            </Link>
            <div className='h-[55%]'>
                <LiveTracking routeFrom={ride?.pickup} routeTo={ride?.destination} />
            </div>
            <div className='sheet relative -mt-5 h-[45%] overflow-y-auto px-4 pb-4 pt-3'>
                <div className='handle' />
                <h3 className='text-[22px] font-bold'>Heading to your destination</h3>

                <div className='mt-3 flex items-center gap-4 rounded-xl bg-[#f6f6f6] p-3'>
                    <div className='flex h-12 w-12 items-center justify-center rounded-full bg-black text-lg font-semibold uppercase text-white'>
                        {captain?.fullname?.firstname?.[ 0 ] || '?'}
                    </div>
                    <div className='min-w-0 flex-1'>
                        <h4 className='truncate text-base font-semibold capitalize'>{captain?.fullname?.firstname}</h4>
                        <p className='text-sm capitalize text-[#6b6b6b]'>{vehicle?.color} {kind.name}</p>
                    </div>
                    <span className='rounded-md border-2 border-black px-2 py-1 text-sm font-bold tracking-wider'>{vehicle?.plate}</span>
                </div>

                <div className='mt-4'>
                    <RouteTimeline pickup={ride?.pickup} destination={ride?.destination} />
                </div>

                <div className='mt-4 flex items-center justify-between border-t border-[#eeeeee] pt-3 text-sm'>
                    <span className='text-[#6b6b6b]'>Pay by {ride?.paymentMethod || 'cash'}, taken when the trip ends</span>
                    <span className='text-base font-semibold'>₹{ride?.fare}</span>
                </div>
            </div>
        </div>
    )
}

export default Riding
