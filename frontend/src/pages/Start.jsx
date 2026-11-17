import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { enterAs } from '../guest'

const VEHICLES = [
  { type: 'car', label: 'Car', icon: 'ri-car-fill' },
  { type: 'moto', label: 'Moto', icon: 'ri-motorbike-fill' },
  { type: 'auto', label: 'Auto', icon: 'ri-taxi-fill' }
]

// The Uber splash: all black, white wordmark, actions in a white sheet.
const Start = () => {
  const navigate = useNavigate()
  const [ picking, setPicking ] = useState(false)   // driver is choosing a vehicle
  const [ busy, setBusy ] = useState(false)
  const [ error, setError ] = useState('')

  const go = async (role, vehicleType) => {
    setBusy(true)
    setError('')
    try {
      await enterAs(role, vehicleType)
      navigate(role === 'captain' ? '/captain-home' : '/home')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reach the server. Is it running?')
      setBusy(false)
    }
  }

  return (
    <div className='flex h-screen w-full flex-col justify-between bg-black'>
      <div className='flex flex-1 items-center justify-center'>
        <img className='w-40 invert' src="https://upload.wikimedia.org/wikipedia/commons/c/cc/Uber_logo_2018.png" alt="Uber" />
      </div>

      <div className='sheet px-4 pb-8 pt-3'>
        <div className='handle' />
        {!picking ? (
          <>
            <h2 className='mb-4 text-[26px] font-bold leading-tight'>Go anywhere with Uber</h2>
            <button disabled={busy} onClick={() => go('user')} className='btn btn-black'>
              {busy ? 'Starting…' : 'Get a ride'}
            </button>
            <button disabled={busy} onClick={() => setPicking(true)} className='btn btn-grey mt-2'>
              Drive and earn
            </button>
          </>
        ) : (
          <>
            <h2 className='mb-1 text-[26px] font-bold leading-tight'>Pick your vehicle</h2>
            <p className='mb-4 text-sm text-[#6b6b6b]'>Riders asking for this type will be matched to you.</p>
            <div className='grid grid-cols-3 gap-2'>
              {VEHICLES.map(v => (
                <button
                  key={v.type}
                  disabled={busy}
                  onClick={() => go('captain', v.type)}
                  className='flex flex-col items-center gap-1 rounded-xl bg-[#eeeeee] py-4 text-sm font-medium active:bg-black active:text-white disabled:opacity-40'>
                  <i className={`${v.icon} text-3xl`}></i>
                  {v.label}
                </button>
              ))}
            </div>
            <button onClick={() => setPicking(false)} className='mt-4 w-full text-center text-sm font-medium text-[#6b6b6b]'>Back</button>
          </>
        )}
        {error && <p className='mt-3 text-sm font-medium text-[#e11900]'>{error}</p>}
      </div>
    </div>
  )
}

export default Start
