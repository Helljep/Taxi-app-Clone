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
                height: '58%',
                padding: '4px 16px'
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
            <div className='absolute left-4 top-4 z-10'>
                <Link to='/history' className='flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-md'>
                    <i className="text-xl ri-history-line"></i>
                </Link>
            </div>
            <div className='absolute right-4 top-4 z-10'>
                <button onClick={topUpWallet} className='rounded-full bg-white px-4 py-3 text-sm font-semibold shadow-md'>
                    <i className="ri-wallet-3-line"></i> ₹{user.wallet ?? 0} <span className='ml-1 text-[#276ef1]'>Add</span>
                </button>
            </div>
            {notice && (
                <div onClick={() => setNotice('')} className='absolute left-4 right-4 top-20 z-20 rounded-lg bg-black p-3 text-sm font-medium text-white shadow-lg'>
                    {notice}
                </div>
            )}
            <div className='h-screen w-screen'>
                <LiveTracking showHeatmap routeFrom={routeFrom} routeTo={routeTo} />
            </div>
            <div className='pointer-events-none absolute top-0 flex h-screen w-full flex-col justify-end'>
                <div className='sheet pointer-events-auto relative shrink-0 px-4 pb-5 pt-3'>
                    <div className='handle' />
                    <h5 ref={panelCloseRef} onClick={() => {
                        setPanelOpen(false)
                    }} className='absolute right-4 top-4 text-2xl opacity-0'>
                        <i className="ri-arrow-down-wide-line"></i>
                    </h5>
                    <h4 className='mb-3 text-[22px] font-bold'>Where to?</h4>
                    <form className='relative' onSubmit={(e) => {
                        submitHandler(e)
                    }}>
                        {/* dot, line and square line up with the centres of the two fields (52px tall, 8px apart) */}
                        <span className='pointer-events-none absolute left-[21px] top-[26px] h-[60px] w-px bg-[#bdbdbd]' />
                        <span className='pointer-events-none absolute left-[17px] top-[22px] h-2 w-2 rounded-full bg-black' />
                        <span className='pointer-events-none absolute left-[17px] top-[82px] h-2 w-2 bg-black' />
                        <input
                            onClick={() => {
                                setPanelOpen(true)
                                setActiveField('pickup')
                            }}
                            value={pickup}
                            onChange={handlePickupChange}
                            className='field pl-11'
                            type="text"
                            placeholder='Pickup location'
                        />
                        <input
                            onClick={() => {
                                setPanelOpen(true)
                                setActiveField('destination')
                            }}
                            value={destination}
                            onChange={handleDestinationChange}
                            className='field mt-2 pl-11'
                            type="text"
                            placeholder='Where to?' />
                    </form>
                    <button
                        onClick={findTrip}
                        disabled={!pickup || !destination}
                        className='btn btn-black mt-3'>
                        See prices
                    </button>
                </div>
                <div ref={panelRef} className='pointer-events-auto h-0 overflow-y-auto bg-white'>
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
            <div className={`sheet fixed bottom-0 z-10 w-full px-4 pb-6 pt-3 transition-transform duration-300 ${vehiclePanel ? 'translate-y-0' : 'pointer-events-none translate-y-[110%]'}`}>
                <VehiclePanel
                    selectVehicle={setVehicleType}
                    fare={fare} setConfirmRidePanel={setConfirmRidePanel} setVehiclePanel={setVehiclePanel} />
            </div>
            <div className={`sheet fixed bottom-0 z-10 w-full px-4 pb-6 pt-3 transition-transform duration-300 ${confirmRidePanel ? 'translate-y-0' : 'pointer-events-none translate-y-[110%]'}`}>
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
            <div className={`sheet fixed bottom-0 z-10 w-full px-4 pb-6 pt-3 transition-transform duration-300 ${vehicleFound ? 'translate-y-0' : 'pointer-events-none translate-y-[110%]'}`}>
                <LookingForDriver
                    cancelRide={cancelRide}
                    createRide={createRide}
                    pickup={pickup}
                    destination={destination}
                    fare={fare}
                    vehicleType={vehicleType}
                    setVehicleFound={setVehicleFound} />
            </div>
            <div className={`sheet fixed bottom-0 z-10 w-full px-4 pb-6 pt-3 transition-transform duration-300 ${waitingForDriver ? 'translate-y-0' : 'pointer-events-none translate-y-[110%]'}`}>
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
