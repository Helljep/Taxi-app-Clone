import React, { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CaptainDetails from '../components/CaptainDetails'
import RidePopUp from '../components/RidePopUp'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import ConfirmRidePopUp from '../components/ConfirmRidePopUp'
import { useEffect, useContext } from 'react'
import { SocketContext } from '../context/SocketContext'
import { CaptainDataContext } from '../context/CapatainContext'
import axios from 'axios'
import LiveTracking from '../components/LiveTracking'

const CaptainHome = () => {

    const [ ridePopupPanel, setRidePopupPanel ] = useState(false)
    const [ confirmRidePopupPanel, setConfirmRidePopupPanel ] = useState(false)

    const ridePopupPanelRef = useRef(null)
    const confirmRidePopupPanelRef = useRef(null)
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


    useGSAP(function () {
        if (ridePopupPanel) {
            gsap.to(ridePopupPanelRef.current, {
                transform: 'translateY(0)'
            })
        } else {
            gsap.to(ridePopupPanelRef.current, {
                transform: 'translateY(100%)'
            })
        }
    }, [ ridePopupPanel ])

    useGSAP(function () {
        if (confirmRidePopupPanel) {
            gsap.to(confirmRidePopupPanelRef.current, {
                transform: 'translateY(0)'
            })
        } else {
            gsap.to(confirmRidePopupPanelRef.current, {
                transform: 'translateY(100%)'
            })
        }
    }, [ confirmRidePopupPanel ])

    return (
        <div className='h-screen'>
            <div className='fixed p-6 top-0 flex items-center justify-between w-screen'>
                <img className='w-16' src="https://upload.wikimedia.org/wikipedia/commons/c/cc/Uber_logo_2018.png" alt="" />
                <Link to='/captain-home' className=' h-10 w-10 bg-white flex items-center justify-center rounded-full'>
                    <i className="text-lg font-medium ri-logout-box-r-line"></i>
                </Link>
            </div>
            <div className='h-3/5'>
                <LiveTracking showHeatmap />
            </div>
            <div className='h-2/5 p-6'>
                <CaptainDetails />
            </div>
            <div ref={ridePopupPanelRef} className='fixed w-full z-10 bottom-0 translate-y-full bg-white px-3 py-10 pt-12'>
                <RidePopUp
                    ride={ride}
                    setRidePopupPanel={setRidePopupPanel}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel}
                    confirmRide={confirmRide}
                    declineRide={declineRide}
                />
            </div>
            <div ref={confirmRidePopupPanelRef} className='fixed w-full h-screen z-10 bottom-0 translate-y-full bg-white px-3 py-10 pt-12'>
                <ConfirmRidePopUp
                    ride={ride}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel} setRidePopupPanel={setRidePopupPanel} />
            </div>
        </div>
    )
}

export default CaptainHome