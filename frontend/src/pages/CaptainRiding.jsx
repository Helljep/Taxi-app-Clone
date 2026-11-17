import React, { useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import FinishRide from '../components/FinishRide'
import LiveTracking from '../components/LiveTracking'

const CaptainRiding = () => {

    const [ finishRidePanel, setFinishRidePanel ] = useState(false)
    const location = useLocation()
    const rideData = location.state?.ride




    const [ title, ...rest ] = (rideData?.destination || '').split(',')

    return (
        <div className='relative flex h-screen flex-col justify-end'>

            <div className='fixed left-4 top-4 z-10 rounded-full bg-black px-4 py-2 text-sm font-semibold text-white shadow-md'>
                <i className="ri-steering-2-line"></i> On trip
            </div>

            <div className='sheet relative z-10 px-4 pb-6 pt-3' onClick={() => setFinishRidePanel(true)}>
                <div className='handle' />
                <p className='text-sm font-medium text-[#6b6b6b]'>Drop-off</p>
                <p className='truncate text-xl font-bold'>{title || 'Destination'}</p>
                {rest.length > 0 && <p className='truncate text-sm text-[#6b6b6b]'>{rest.join(',').trim()}</p>}
                <button className='btn btn-black mt-4'>Complete trip</button>
            </div>

            <div className={`sheet fixed bottom-0 z-[500] w-full px-4 pb-6 pt-3 transition-transform duration-300 ${finishRidePanel ? 'translate-y-0' : 'pointer-events-none translate-y-[110%]'}`}>
                <FinishRide
                    ride={rideData}
                    setFinishRidePanel={setFinishRidePanel} />
            </div>

            <div className='fixed top-0 z-0 h-screen w-screen'>
                <LiveTracking routeFrom={rideData?.pickup} routeTo={rideData?.destination} />
            </div>

        </div>
    )
}

export default CaptainRiding
