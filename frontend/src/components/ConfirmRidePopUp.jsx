import React, { useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import RouteTimeline from './RouteTimeline'

const ConfirmRidePopUp = (props) => {
    const [ otp, setOtp ] = useState('')
    const [ error, setError ] = useState('')
    const navigate = useNavigate()

    const submitHander = async (e) => {
        e.preventDefault()
        setError('')

        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/start-ride`, {
                params: {
                    rideId: props.ride._id,
                    otp: otp
                },
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            })

            if (response.status === 200) {
                props.setConfirmRidePopupPanel(false)
                props.setRidePopupPanel(false)
                navigate('/captain-riding', { state: { ride: props.ride } })
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Could not start the trip. Check the PIN.')
        }
    }

    return (
        <div>
            <div className='handle' />
            <h3 className='text-[22px] font-bold'>Pick up <span className='capitalize'>{props.ride?.user?.fullname?.firstname}</span></h3>
            <p className='mb-4 mt-1 text-sm text-[#6b6b6b]'>
                {props.ride?.pickupEtaMinutes ? `${props.ride.pickupEtaMinutes} min away · ` : ''}Ask the rider for their 6-digit PIN to start the trip.
            </p>

            <RouteTimeline pickup={props.ride?.pickup} destination={props.ride?.destination} />

            <div className='mt-4 flex items-center justify-between border-t border-[#eeeeee] pt-3 text-sm'>
                <span className='capitalize text-[#6b6b6b]'>{props.ride?.paymentMethod || 'cash'}</span>
                <span className='text-base font-semibold'>₹{props.ride?.fare}</span>
            </div>

            <form onSubmit={submitHander} className='mt-4'>
                <input
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode='numeric'
                    className='field text-center font-mono text-2xl tracking-[0.5em]'
                    placeholder='······' />
                {error && <p className='mt-2 text-sm font-medium text-[#e11900]'>{error}</p>}

                <button disabled={otp.length !== 6} className='btn btn-black mt-3'>Start trip</button>
                <button type='button' onClick={async () => {
                    // cancelling after accepting tells the rider, so they can book someone else
                    try {
                        await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/cancel-by-captain`, { rideId: props.ride._id }, {
                            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                        })
                    } catch (err) {
                        console.log(err.response?.data?.message || err.message)
                    }
                    props.setConfirmRidePopupPanel(false)
                    props.setRidePopupPanel(false)
                }} className='btn btn-grey mt-2 !text-[#e11900]'>Cancel trip</button>
            </form>
        </div>
    )
}

export default ConfirmRidePopUp
