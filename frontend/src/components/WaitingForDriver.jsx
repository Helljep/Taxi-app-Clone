import React from 'react'
import RouteTimeline from './RouteTimeline'
import { RIDES } from './VehiclePanel'

const WaitingForDriver = (props) => {
    const captain = props.ride?.captain
    const vehicle = captain?.vehicle
    const kind = RIDES[ vehicle?.vehicleType ] || RIDES.car
    const digits = String(props.ride?.otp || '').split('')

    return (
        <div>
            <div className='handle' />
            <h3 className='text-[22px] font-bold'>Meet at the pickup point</h3>
            <p className='mb-4 mt-1 text-sm text-[#6b6b6b]'>Your driver is on the way. Share the PIN below to start the trip.</p>

            <div className='flex items-center gap-4 rounded-xl bg-[#f6f6f6] p-3'>
                <div className='flex h-12 w-12 items-center justify-center rounded-full bg-black text-lg font-semibold uppercase text-white'>
                    {captain?.fullname?.firstname?.[ 0 ] || '?'}
                </div>
                <div className='min-w-0 flex-1'>
                    <h4 className='truncate text-base font-semibold capitalize'>{captain?.fullname?.firstname}</h4>
                    <p className='text-sm capitalize text-[#6b6b6b]'>{vehicle?.color} {kind.name}</p>
                </div>
                <span className='rounded-md border-2 border-black px-2 py-1 text-sm font-bold tracking-wider'>{vehicle?.plate}</span>
            </div>

            <div className='my-4'>
                <p className='mb-2 text-sm font-medium'>Start your trip with this PIN</p>
                <div className='flex gap-2'>
                    {digits.map((d, i) => (
                        <span key={i} className='flex h-12 flex-1 items-center justify-center rounded-lg bg-black text-xl font-semibold text-white'>{d}</span>
                    ))}
                </div>
            </div>

            <RouteTimeline pickup={props.ride?.pickup} destination={props.ride?.destination} />

            <div className='mt-4 flex items-center justify-between border-t border-[#eeeeee] pt-3 text-sm'>
                <span className='text-[#6b6b6b]'>Pay by {props.ride?.paymentMethod || 'cash'}</span>
                <span className='text-base font-semibold'>₹{props.ride?.fare}</span>
            </div>

            <button onClick={props.cancelRide} className='btn btn-grey mt-4'>Cancel trip</button>
        </div>
    )
}

export default WaitingForDriver
