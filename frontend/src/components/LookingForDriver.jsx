import React from 'react'
import RouteTimeline from './RouteTimeline'
import { RIDES } from './VehiclePanel'
import VehicleIcon from './VehicleIcon'

const LookingForDriver = (props) => {
    const ride = RIDES[ props.vehicleType ] || RIDES.car

    return (
        <div>
            <div className='handle' />
            <h3 className='text-[22px] font-bold'>Finding your ride</h3>
            <p className='mb-3 mt-1 text-sm text-[#6b6b6b]'>We offer your trip to the closest driver first, then the next one.</p>
            <div className='progress mb-4' />

            <div className='mb-4 flex items-center gap-4'>
                <VehicleIcon type={props.vehicleType || 'car'} />
                <div className='flex-1'>
                    <h4 className='text-base font-semibold'>{ride.name}</h4>
                    <p className='text-sm text-[#6b6b6b]'>{ride.desc}</p>
                </div>
                <p className='text-lg font-semibold'>₹{props.fare[ props.vehicleType ]}</p>
            </div>

            <RouteTimeline pickup={props.pickup} destination={props.destination} />

            <button onClick={props.cancelRide} className='btn btn-grey mt-5'>Cancel</button>
        </div>
    )
}

export default LookingForDriver
