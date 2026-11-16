import React, { useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import axios from 'axios';
import 'remixicon/fonts/remixicon.css'
import LocationSearchPanel from '../components/LocationSearchPanel';
import VehiclePanel from '../components/VehiclePanel';
import ConfirmRide from '../components/ConfirmRide';
import LookingForDriver from '../components/LookingForDriver';
import WaitingForDriver from '../components/WaitingForDriver';
import { SocketContext } from '../context/SocketContext';
import { useContext } from 'react';
import { UserDataContext } from '../context/UserContext';
import { useNavigate, Link } from 'react-router-dom';
import LiveTracking from '../components/LiveTracking';

const Home = () => {
    const [ pickup, setPickup ] = useState('')
    const [ destination, setDestination ] = useState('')
    const [ panelOpen, setPanelOpen ] = useState(false)
    const vehiclePanelRef = useRef(null)
    const confirmRidePanelRef = useRef(null)
    const vehicleFoundRef = useRef(null)
    const waitingForDriverRef = useRef(null)
    const panelRef = useRef(null)
    const panelCloseRef = useRef(null)
    const [ vehiclePanel, setVehiclePanel ] = useState(false)
    const [ confirmRidePanel, setConfirmRidePanel ] = useState(false)
    const [ vehicleFound, setVehicleFound ] = useState(false)
    const [ waitingForDriver, setWaitingForDriver ] = useState(false)
    const [ pickupSuggestions, setPickupSuggestions ] = useState([])
    const [ destinationSuggestions, setDestinationSuggestions ] = useState([])
    const [ activeField, setActiveField ] = useState(null)
    const [ fare, setFare ] = useState({})
    const [ vehicleType, setVehicleType ] = useState(null)
    const [ ride, setRide ] = useState(null)
    const [ pendingRide, setPendingRide ] = useState(null)
    const [ paymentMethod, setPaymentMethod ] = useState('cash')
    const [ notice, setNotice ] = useState('')
    const [ routeFrom, setRouteFrom ] = useState(null)
    const [ routeTo, setRouteTo ] = useState(null)

    const navigate = useNavigate()

    const { socket } = useContext(SocketContext)
    const { user, setUser } = useContext(UserDataContext)

    useEffect(() => {
        socket.emit("join", {
            userType: "user",
            userId: user._id,
            token: localStorage.getItem('token')
        })
    }, [ user ])

    useEffect(() => {
        const handleRideConfirmed = (ride) => {
            setVehicleFound(false)
            setWaitingForDriver(true)
            setRide(ride)
        }

        const handleRideStarted = (ride) => {
            setWaitingForDriver(false)
            navigate('/riding', { state: { ride } }) // Updated navigate to include ride data
        }

        // the captain cancelled, or nobody nearby accepted: go back to the start
        const handleRideCancelled = (cancelled) => {
            setVehicleFound(false)
            setWaitingForDriver(false)
            setRide(null)
            setPendingRide(null)
            setNotice(cancelled.cancelledBy === 'captain'
                ? 'Your captain cancelled the ride. Please book again.'
                : (cancelled.reason || 'Your ride was cancelled.'))
        }

        socket.on('ride-confirmed', handleRideConfirmed)
        socket.on('ride-started', handleRideStarted)
        socket.on('ride-cancelled', handleRideCancelled)

        // remove the listeners when leaving the page so they don't pile up
        return () => {
            socket.off('ride-confirmed', handleRideConfirmed)
            socket.off('ride-started', handleRideStarted)
            socket.off('ride-cancelled', handleRideCancelled)
        }
    }, [])


    // wait until the person stops typing for a moment before asking for suggestions
    // (the free map search allows only about one request per second)
    const suggestionTimer = useRef(null)

    const fetchSuggestions = (text, setSuggestions) => {
        clearTimeout(suggestionTimer.current)

        if (text.length < 3) {
            setSuggestions([])
            return
        }

        suggestionTimer.current = setTimeout(async () => {
            try {
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-suggestions`, {
                    params: { input: text },
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('token')}`
                    }
                })
                setSuggestions(response.data)
            } catch {
                // handle error
            }
        }, 500)
    }

    const handlePickupChange = (e) => {
        setPickup(e.target.value)
        fetchSuggestions(e.target.value, setPickupSuggestions)
    }

    const handleDestinationChange = (e) => {
        setDestination(e.target.value)
        fetchSuggestions(e.target.value, setDestinationSuggestions)
    }

    const submitHandler = (e) => {
        e.preventDefault()
    }

    useGSAP(function () {
        if (panelOpen) {
            gsap.to(panelRef.current, {
                height: '70%',
                padding: 24
                // opacity:1
            })
            gsap.to(panelCloseRef.current, {
                opacity: 1
            })
        } else {
            gsap.to(panelRef.current, {
                height: '0%',
                padding: 0
                // opacity:0
            })
            gsap.to(panelCloseRef.current, {
                opacity: 0
            })
        }
    }, [ panelOpen ])


    useGSAP(function () {
        if (vehiclePanel) {
            gsap.to(vehiclePanelRef.current, {
                transform: 'translateY(0)'
            })
        } else {
            gsap.to(vehiclePanelRef.current, {
                transform: 'translateY(100%)'
            })
        }
    }, [ vehiclePanel ])

    useGSAP(function () {
        if (confirmRidePanel) {
            gsap.to(confirmRidePanelRef.current, {
                transform: 'translateY(0)'
            })
        } else {
            gsap.to(confirmRidePanelRef.current, {
                transform: 'translateY(100%)'
            })
        }
    }, [ confirmRidePanel ])

    useGSAP(function () {
        if (vehicleFound) {
            gsap.to(vehicleFoundRef.current, {
                transform: 'translateY(0)'
            })
        } else {
            gsap.to(vehicleFoundRef.current, {
                transform: 'translateY(100%)'
            })
        }
    }, [ vehicleFound ])

    useGSAP(function () {
        if (waitingForDriver) {
            gsap.to(waitingForDriverRef.current, {
                transform: 'translateY(0)'
            })
        } else {
            gsap.to(waitingForDriverRef.current, {
                transform: 'translateY(100%)'
            })
        }
    }, [ waitingForDriver ])


    async function findTrip() {
        setVehiclePanel(true)
        setPanelOpen(false)
        setNotice('')
        setFare({})

        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/get-fare`, {
                params: { pickup, destination },
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            })

            setFare(response.data)

            // draw the route on the map
            setRouteFrom(pickup)
            setRouteTo(destination)
        } catch {
            setVehiclePanel(false)
            setNotice('Could not find a price for that trip. Check both addresses.')
        }
    }

    async function createRide() {
        try {
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/create`, {
                pickup,
                destination,
                vehicleType,
                paymentMethod
            }, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            })

            // keep the id of the waiting ride so it can be cancelled.
            // (kept apart from "ride", which only holds a ride a captain accepted)
            setPendingRide(response.data)
        } catch (err) {
            setVehicleFound(false)
            setNotice(err.response?.data?.message || 'Could not book the ride. Please try again.')
        }
    }

    async function cancelRide() {
        const rideId = ride?._id || pendingRide?._id
        if (!rideId) return

        try {
            await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/cancel`, { rideId }, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            })
            setVehicleFound(false)
            setWaitingForDriver(false)
            setRide(null)
            setPendingRide(null)
            setNotice('Ride cancelled.')
        } catch (err) {
            setNotice(err.response?.data?.message || 'This ride can no longer be cancelled.')
        }
    }

    async function topUpWallet() {
        const amount = Number(window.prompt('Add how many rupees to your wallet? (1 to 10000)', '200'))
        if (!amount) return

        try {
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/users/wallet/topup`, { amount }, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            })
            setUser({ ...user, wallet: response.data.wallet })
        } catch (err) {
            setNotice(err.response?.data?.message || 'Could not add money.')
        }
    }

    return (
        <div className='h-screen relative overflow-hidden'>
            <img className='w-16 absolute left-5 top-5 z-10' src="https://upload.wikimedia.org/wikipedia/commons/c/cc/Uber_logo_2018.png" alt="" />
            <div className='absolute right-4 top-4 z-10 flex items-center gap-2'>
                <button onClick={topUpWallet} className='bg-white px-3 py-2 rounded-full text-sm font-semibold shadow'>
                    <i className="ri-wallet-3-line"></i> ₹{user.wallet ?? 0} +
                </button>
                <Link to='/history' className='h-10 w-10 bg-white flex items-center justify-center rounded-full shadow'>
                    <i className="text-lg ri-history-line"></i>
                </Link>
            </div>
            {notice && (
                <div onClick={() => setNotice('')} className='absolute top-20 left-4 right-4 z-20 bg-black text-white text-sm p-3 rounded-lg'>
                    {notice}
                </div>
            )}
            <div className='h-screen w-screen'>
                <LiveTracking showHeatmap routeFrom={routeFrom} routeTo={routeTo} />
            </div>
            <div className=' flex flex-col justify-end h-screen absolute top-0 w-full'>
                <div className='h-[30%] p-6 bg-white relative'>
                    <h5 ref={panelCloseRef} onClick={() => {
                        setPanelOpen(false)
                    }} className='absolute opacity-0 right-6 top-6 text-2xl'>
                        <i className="ri-arrow-down-wide-line"></i>
                    </h5>
                    <h4 className='text-2xl font-semibold'>Find a trip</h4>
                    <form className='relative py-3' onSubmit={(e) => {
                        submitHandler(e)
                    }}>
                        <div className="line absolute h-16 w-1 top-[50%] -translate-y-1/2 left-5 bg-gray-700 rounded-full"></div>
                        <input
                            onClick={() => {
                                setPanelOpen(true)
                                setActiveField('pickup')
                            }}
                            value={pickup}
                            onChange={handlePickupChange}
                            className='bg-[#eee] px-12 py-2 text-lg rounded-lg w-full'
                            type="text"
                            placeholder='Add a pick-up location'
                        />
                        <input
                            onClick={() => {
                                setPanelOpen(true)
                                setActiveField('destination')
                            }}
                            value={destination}
                            onChange={handleDestinationChange}
                            className='bg-[#eee] px-12 py-2 text-lg rounded-lg w-full  mt-3'
                            type="text"
                            placeholder='Enter your destination' />
                    </form>
                    <button
                        onClick={findTrip}
                        className='bg-black text-white px-4 py-2 rounded-lg mt-3 w-full'>
                        Find Trip
                    </button>
                </div>
                <div ref={panelRef} className='bg-white h-0'>
                    <LocationSearchPanel
                        suggestions={activeField === 'pickup' ? pickupSuggestions : destinationSuggestions}
                        setPanelOpen={setPanelOpen}
                        setVehiclePanel={setVehiclePanel}
                        setPickup={setPickup}
                        setDestination={setDestination}
                        activeField={activeField}
                    />
                </div>
            </div>
            <div ref={vehiclePanelRef} className='fixed w-full z-10 bottom-0 translate-y-full bg-white px-3 py-10 pt-12'>
                <VehiclePanel
                    selectVehicle={setVehicleType}
                    fare={fare} setConfirmRidePanel={setConfirmRidePanel} setVehiclePanel={setVehiclePanel} />
            </div>
            <div ref={confirmRidePanelRef} className='fixed w-full z-10 bottom-0 translate-y-full bg-white px-3 py-6 pt-12'>
                <ConfirmRide
                    paymentMethod={paymentMethod}
                    setPaymentMethod={setPaymentMethod}
                    walletBalance={user.wallet}
                    createRide={createRide}
                    pickup={pickup}
                    destination={destination}
                    fare={fare}
                    vehicleType={vehicleType}

                    setConfirmRidePanel={setConfirmRidePanel} setVehicleFound={setVehicleFound} />
            </div>
            <div ref={vehicleFoundRef} className='fixed w-full z-10 bottom-0 translate-y-full bg-white px-3 py-6 pt-12'>
                <LookingForDriver
                    cancelRide={cancelRide}
                    createRide={createRide}
                    pickup={pickup}
                    destination={destination}
                    fare={fare}
                    vehicleType={vehicleType}
                    setVehicleFound={setVehicleFound} />
            </div>
            <div ref={waitingForDriverRef} className='fixed w-full  z-10 bottom-0  bg-white px-3 py-6 pt-12'>
                <WaitingForDriver
                    cancelRide={cancelRide}
                    ride={ride}
                    setVehicleFound={setVehicleFound}
                    setWaitingForDriver={setWaitingForDriver}
                    waitingForDriver={waitingForDriver} />
            </div>
        </div>
    )
}

export default Home