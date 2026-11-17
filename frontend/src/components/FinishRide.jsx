import React from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import RouteTimeline from './RouteTimeline'


const FinishRide = (props) => {

    const navigate = useNavigate()

    async function endRide() {
        const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/end-ride`, {

            rideId: props.ride._id

        }, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        })

        if (response.status === 200) {
            navigate('/captain-home')
        }

    }

    return (
        <div>
            <div className='handle' onClick={() => props.setFinishRidePanel(false)} />
            <h3 className='text-[22px] font-bold'>Complete trip</h3>
            <p className='mb-4 mt-1 text-sm text-[#6b6b6b]'>
                {props.ride?.paymentMethod === 'wallet'
                    ? "Paid from the rider's wallet. Collect cash only if the wallet was short."
                    : 'Collect cash from the rider.'}
            </p>

            <div className='mb-4 flex items-center justify-between rounded-xl bg-[#f6f6f6] p-4'>
                <div className='flex items-center gap-3'>
                    <span className='flex h-10 w-10 items-center justify-center rounded-full bg-black text-white'><i className="ri-user-3-fill"></i></span>
                    <span className='font-medium capitalize'>{props.ride?.user?.fullname?.firstname}</span>
                </div>
                <span className='text-2xl font-bold'>₹{props.ride?.fare}</span>
            </div>

            <RouteTimeline pickup={props.ride?.pickup} destination={props.ride?.destination} />

            <button onClick={endRide} className='btn btn-black mt-5'>Complete trip</button>
        </div>
    )
}

export default FinishRide
