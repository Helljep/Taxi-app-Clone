import React, { useEffect, useState } from 'react'
import RouteTimeline from './RouteTimeline'

const RidePopUp = (props) => {
    // countdown: the ride moves to the next captain when this reaches zero
    const [ secondsLeft, setSecondsLeft ] = useState(0)
    const total = props.ride?.offerSeconds || 15

    useEffect(() => {
        if (!props.ride?.offerSeconds) return
        setSecondsLeft(props.ride.offerSeconds)

        const timer = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000)
        return () => clearInterval(timer)
    }, [ props.ride?._id ])

    return (
        <div>
            <div className='handle' onClick={() => props.setRidePopupPanel(false)} />

            {/* shrinking bar: how long this request stays on offer */}
            <div className='mb-4 h-1 overflow-hidden rounded-full bg-[#e6e6e6]'>
                <div className='h-full bg-black transition-all duration-1000 ease-linear' style={{ width: `${(secondsLeft / total) * 100}%` }} />
            </div>

            <div className='flex items-end justify-between'>
                <div>
                    <p className='text-sm font-medium text-[#6b6b6b]'>New trip request</p>
                    <p className='text-4xl font-bold'>₹{props.ride?.fare}</p>
                </div>
                <div className='text-right text-sm'>
                    <p className='font-semibold'>{props.ride?.pickupEtaMinutes ? `${props.ride.pickupEtaMinutes} min away` : 'Nearby'}</p>
                    <p className='capitalize text-[#6b6b6b]'>
                        {props.ride?.paymentMethod || 'cash'}{props.ride?.surgeMultiplier > 1 && ` · ${props.ride.surgeMultiplier}x`}
                    </p>
                </div>
            </div>

            <div className='my-4 flex items-center gap-3 text-sm'>
                <span className='flex h-9 w-9 items-center justify-center rounded-full bg-[#eeeeee]'><i className="ri-user-3-fill"></i></span>
                <span className='font-medium capitalize'>{props.ride?.user?.fullname?.firstname}</span>
            </div>

            <RouteTimeline pickup={props.ride?.pickup} destination={props.ride?.destination} />

            <button onClick={() => props.confirmRide()} className='btn btn-black mt-5'>
                Accept{secondsLeft > 0 && ` · ${secondsLeft}s`}
            </button>
            <button onClick={() => props.declineRide()} className='btn btn-grey mt-2'>Decline</button>
        </div>
    )
}

export default RidePopUp
