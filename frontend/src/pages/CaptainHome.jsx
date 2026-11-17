import React, { useRef, useState } from 'react'
import CaptainDetails from '../components/CaptainDetails'
import RidePopUp from '../components/RidePopUp'
import ConfirmRidePopUp from '../components/ConfirmRidePopUp'
import { useEffect, useContext } from 'react'
import { SocketContext } from '../context/SocketContext'
import { CaptainDataContext } from '../context/CapatainContext'
import axios from 'axios'
import LiveTracking from '../components/LiveTracking'

const CaptainHome = () => {

    const [ ridePopupPanel, setRidePopupPanel ] = useState(false)
    const [ confirmRidePopupPanel, setConfirmRidePopupPanel ] = useState(false)

    const [ ride, setRide ] = useState(null)
    const rideRef = useRef(null)   // lets socket listeners see the current ride

    const { socket } = useContext(SocketContext)
    const { captain } = useContext(CaptainDataContext)

    useEffect(() => {
        socket.emit('join', {
            userId: captain._id,
            userType: 'captain',
            token: localStorage.getItem('token')
        })

        const handleNewRide = (data) => {
            rideRef.current = data
            setRide(data)
            setRidePopupPanel(true)
        }

        // the offer ran out of time (or was taken back): close the pop-up
        const handleOfferExpired = ({ rideId }) => {
            if (rideRef.current?._id === rideId) {
                setRidePopupPanel(false)
            }
        }

        // the rider cancelled
        const handleRideCancelled = (cancelled) => {
            if (rideRef.current?._id === cancelled._id) {
                setRidePopupPanel(false)
                setConfirmRidePopupPanel(false)
                window.alert('The rider cancelled this ride.')
            }
        }

        socket.on('new-ride', handleNewRide)
        socket.on('ride-offer-expired', handleOfferExpired)
        socket.on('ride-cancelled', handleRideCancelled)

        return () => {
            socket.off('new-ride', handleNewRide)
            socket.off('ride-offer-expired', handleOfferExpired)
            socket.off('ride-cancelled', handleRideCancelled)
        }
    }, [])

    // "Ignore": tell the server so the ride goes to the next captain straight away
    async function declineRide() {
        setRidePopupPanel(false)
        try {
            await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/decline`, { rideId: ride._id }, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            })
        } catch (err) {
            console.log(err.message)
        }
    }

    // the captain's position is shared by the map itself (see LiveTracking)

    async function confirmRide() {

        try {
            await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/confirm`, {

                rideId: ride._id,
                captainId: captain._id,


            }, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            })

            setRidePopupPanel(false)
            setConfirmRidePopupPanel(true)
        } catch (err) {
            // the offer expired, or the rider cancelled, before we tapped Accept
            setRidePopupPanel(false)
            setConfirmRidePopupPanel(false)
            window.alert(err.response?.data?.message || 'This ride is no longer available.')
        }

    }


    return (
        <div className='h-screen'>
            <div className='fixed left-4 top-4 z-10 rounded-full bg-black px-4 py-2 text-sm font-semibold text-white shadow-md'>
                <i className="ri-steering-2-line"></i> Driver
            </div>
            <div className='h-[58%]'>
                <LiveTracking showHeatmap />
            </div>
            <div className='sheet relative -mt-5 h-[42%] overflow-y-auto px-4 pb-4 pt-3'>
                <div className='handle' />
                <CaptainDetails />
            </div>
            <div className={`sheet fixed bottom-0 z-10 w-full px-4 pb-6 pt-3 transition-transform duration-300 ${ridePopupPanel ? 'translate-y-0' : 'pointer-events-none translate-y-[110%]'}`}>
                <RidePopUp
                    ride={ride}
                    setRidePopupPanel={setRidePopupPanel}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel}
                    confirmRide={confirmRide}
                    declineRide={declineRide}
                />
            </div>
            <div className={`sheet fixed bottom-0 z-10 w-full px-4 pb-6 pt-3 transition-transform duration-300 ${confirmRidePopupPanel ? 'translate-y-0' : 'pointer-events-none translate-y-[110%]'}`}>
                <ConfirmRidePopUp
                    ride={ride}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel} setRidePopupPanel={setRidePopupPanel} />
            </div>
        </div>
    )
}

export default CaptainHome
