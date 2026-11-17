import React from 'react'
import RouteTimeline from './RouteTimeline'
import { RIDES } from './VehiclePanel'
import VehicleIcon from './VehicleIcon'

const ConfirmRide = (props) => {
    const ride = RIDES[ props.vehicleType ] || RIDES.car

    return (
        <div>
            <div className='handle' onClick={() => props.setConfirmRidePanel(false)} />
            <h3 className='mb-4 text-[22px] font-bold'>Confirm your ride</h3>

            <div className='mb-4 flex items-center gap-4 rounded-xl bg-[#f6f6f6] p-3'>
                <VehicleIcon type={props.vehicleType || 'car'} />
                <div className='flex-1'>
                    <h4 className='text-base font-semibold'>{ride.name}</h4>
                    <p className='text-sm text-[#6b6b6b]'>
                        {props.fare.surge?.multiplier > 1 ? `Includes ${props.fare.surge.multiplier}x busy-time pricing` : 'Pay at the end of the trip'}
                    </p>
                </div>
                <p className='text-xl font-bold'>₹{props.fare[ props.vehicleType ]}</p>
            </div>

            <RouteTimeline pickup={props.pickup} destination={props.destination} />

            <div className='mt-4 flex rounded-lg bg-[#eeeeee] p-1'>
                {[ 'cash', 'wallet' ].map(method => (
                    <button
                        key={method}
                        type='button'
                        onClick={() => props.setPaymentMethod(method)}
                        className={`flex-1 rounded-md py-2.5 text-sm font-medium ${props.paymentMethod === method ? 'bg-white shadow' : 'text-[#6b6b6b]'}`}>
                        <i className={method === 'wallet' ? 'ri-wallet-3-line' : 'ri-money-rupee-circle-line'}></i>{' '}
                        {method === 'wallet' ? `Wallet · ₹${props.walletBalance ?? 0}` : 'Cash'}
                    </button>
                ))}
            </div>

            <button
                onClick={() => {
                    props.setVehicleFound(true)
                    props.setConfirmRidePanel(false)
                    props.createRide()
                }}
                className='btn btn-black mt-4'>
                Confirm {ride.name}
            </button>
        </div>
    )
}

export default ConfirmRide
