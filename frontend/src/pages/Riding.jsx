import React, { useState } from 'react'
import axios from 'axios'
import { Link, useLocation } from 'react-router-dom' // Added useLocation
import { useEffect, useContext } from 'react'
import { SocketContext } from '../context/SocketContext'
import { useNavigate } from 'react-router-dom'
import LiveTracking from '../components/LiveTracking'

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


    return (
        <div className='h-screen'>
            {endedRide && (
                <div className='fixed inset-0 z-[1000] bg-black/60 flex items-end'>
                    <div className='bg-white w-full rounded-t-2xl p-6'>
                        <h3 className='text-2xl font-semibold'>You have arrived</h3>
                        <p className='mt-2 text-lg'>₹{endedRide.fare} · {endedRide.paymentStatus === 'cash-due'
                            ? 'wallet was short, please pay your captain in cash'
                            : endedRide.paymentMethod === 'wallet' ? 'paid from your wallet' : 'pay your captain in cash'}</p>
                        <p className='mt-4 text-gray-600'>How was your ride with {endedRide.captain?.fullname?.firstname}?</p>
                        <div className='flex gap-2 mt-2 text-4xl'>
                            {[ 1, 2, 3, 4, 5 ].map(n => (
                                <button key={n} onClick={() => setStars(n)} className={n <= stars ? 'text-yellow-500' : 'text-gray-300'}>★</button>
                            ))}
                        </div>
                        <button onClick={submitRating} className='w-full mt-6 bg-green-600 text-white font-semibold p-3 rounded-lg'>
                            {stars > 0 ? 'Submit rating' : 'Skip'}
                        </button>
                    </div>
                </div>
            )}
            <Link to='/home' className='fixed right-2 top-2 h-10 w-10 bg-white flex items-center justify-center rounded-full z-10'>
                <i className="text-lg font-medium ri-home-5-line"></i>
            </Link>
            <div className='h-1/2'>
                <LiveTracking routeFrom={ride?.pickup} routeTo={ride?.destination} />

            </div>
            <div className='h-1/2 p-4'>
                <div className='flex items-center justify-between'>
                    <img className='h-12' src="https://swyft.pl/wp-content/uploads/2023/05/how-many-people-can-a-uberx-take.jpg" alt="" />
                    <div className='text-right'>
                        <h2 className='text-lg font-medium capitalize'>{ride?.captain.fullname.firstname}</h2>
                        <h4 className='text-xl font-semibold -mt-1 -mb-1'>{ride?.captain.vehicle.plate}</h4>
                        <p className='text-sm text-gray-600'>Maruti Suzuki Alto</p>

                    </div>
                </div>

                <div className='flex gap-2 justify-between flex-col items-center'>
                    <div className='w-full mt-5'>

                        <div className='flex items-center gap-5 p-3 border-b-2'>
                            <i className="text-lg ri-map-pin-2-fill"></i>
                            <div>
                                <h3 className='text-lg font-medium'>562/11-A</h3>
                                <p className='text-sm -mt-1 text-gray-600'>{ride?.destination}</p>
                            </div>
                        </div>
                        <div className='flex items-center gap-5 p-3'>
                            <i className="ri-currency-line"></i>
                            <div>
                                <h3 className='text-lg font-medium'>₹{ride?.fare} </h3>
                                <p className='text-sm -mt-1 text-gray-600'>Pay by {ride?.paymentMethod || 'cash'}</p>
                            </div>
                        </div>
                    </div>
                </div>
                <p className='w-full mt-5 text-center text-gray-500 text-sm'>Payment is taken automatically when the trip ends.</p>
            </div>
        </div>
    )
}

export default Riding