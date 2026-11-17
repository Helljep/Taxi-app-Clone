import React, { useState } from 'react'
import VehicleIcon from './VehicleIcon'

export const RIDES = {
    car: { name: 'UberGo', seats: 4, desc: 'Affordable, compact rides' },
    moto: { name: 'Moto', seats: 1, desc: 'Affordable motorcycle rides' },
    auto: { name: 'UberAuto', seats: 3, desc: 'Affordable auto rides' }
}

// "10:34 PM · 2 min away", like the Uber app (minutes = real driving time of the nearest free captain)
const etaLabel = (minutes) => {
    if (minutes === undefined) return 'Checking nearby drivers…'
    if (minutes === null) return 'No drivers nearby'
    const arrival = new Date(Date.now() + minutes * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    return `${arrival} · ${minutes} min away`
}

const VehiclePanel = (props) => {
    const [ selected, setSelected ] = useState('car')
    const price = props.fare[ selected ]

    return (
        <div>
            <div className='handle' onClick={() => props.setVehiclePanel(false)} />
            <h3 className='mb-3 text-[22px] font-bold'>Choose a ride</h3>

            {props.fare.surge?.multiplier > 1 && (
                <div className='mb-3 flex items-center gap-2 rounded-lg bg-[#fff3e0] p-3 text-sm font-medium text-[#8a4b00]'>
                    <i className="ri-flashlight-fill text-base"></i>
                    <span>Fares are {props.fare.surge.multiplier}x because it's busy here: more ride requests than drivers.</span>
                </div>
            )}

            <div className='-mx-1'>
                {Object.entries(RIDES).map(([ type, ride ]) => (
                    <button
                        key={type}
                        type='button'
                        onClick={() => setSelected(type)}
                        className={`mb-1 flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left ${selected === type ? 'border-black' : 'border-transparent'}`}>
                        <VehicleIcon type={type} />
                        <div className='min-w-0 flex-1'>
                            <h4 className='text-base font-semibold'>
                                {ride.name} <span className='ml-1 text-sm font-normal text-[#6b6b6b]'><i className="ri-user-3-fill"></i> {ride.seats}</span>
                            </h4>
                            <p className='text-sm font-medium'>{etaLabel(props.fare.eta?.[ type ])}</p>
                            <p className='truncate text-xs text-[#6b6b6b]'>{ride.desc}</p>
                        </div>
                        <p className='text-lg font-semibold'>{props.fare[ type ] !== undefined ? `₹${props.fare[ type ]}` : '…'}</p>
                    </button>
                ))}
            </div>

            <div className='my-3 flex items-center gap-3 border-t border-[#eeeeee] pt-3 text-sm font-medium'>
                <i className="ri-money-rupee-circle-line text-xl"></i> Cash or wallet <span className='ml-auto text-[#6b6b6b]'>choose on the next step</span>
            </div>

            <button
                disabled={price === undefined}
                onClick={() => {
                    props.selectVehicle(selected)
                    props.setConfirmRidePanel(true)
                }}
                className='btn btn-black'>
                Choose {RIDES[ selected ].name}
            </button>
        </div>
    )
}

export default VehiclePanel
