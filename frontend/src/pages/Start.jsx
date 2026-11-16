import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { enterAs } from '../guest'

const VEHICLES = [
  { type: 'car', label: 'Car' },
  { type: 'moto', label: 'Moto' },
  { type: 'auto', label: 'Auto' }
]

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
    <div>
      <div className='bg-cover bg-center bg-[url(https://images.unsplash.com/photo-1619059558110-c45be64b73ae?q=80&w=2574&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D)] h-screen pt-8 flex justify-between flex-col w-full'>
        <img className='w-16 ml-8' src="https://cdn-assets-eu.frontify.com/s3/frontify-enterprise-files-eu/eyJwYXRoIjoid2VhcmVcL2ZpbGVcLzhGbTh4cU5SZGZUVjUxYVh3bnEyLnN2ZyJ9:weare:F1cOF9Bps96cMy7r9Y2d7affBYsDeiDoIHfqZrbcxAw?width=1200&height=417" alt="" />
        <div className='bg-white pb-8 py-4 px-4'>
          <h2 className='text-[30px] font-semibold'>Get Started with Uber</h2>

          {!picking ? (
            <>
              <button
                disabled={busy}
                onClick={() => go('user')}
                className='flex items-center justify-center w-full bg-black text-white py-3 rounded-lg mt-5 disabled:opacity-60'
              >{busy ? 'Starting…' : 'Continue as Rider'}</button>
              <button
                disabled={busy}
                onClick={() => setPicking(true)}
                className='flex items-center justify-center w-full bg-green-600 text-white py-3 rounded-lg mt-3 disabled:opacity-60'
              >Continue as Driver</button>
            </>
          ) : (
            <>
              <p className='mt-5 mb-2 font-medium'>Your vehicle</p>
              <div className='flex gap-3'>
                {VEHICLES.map(v => (
                  <button
                    key={v.type}
                    disabled={busy}
                    onClick={() => go('captain', v.type)}
                    className='flex-1 bg-green-600 text-white py-3 rounded-lg disabled:opacity-60'
                  >{v.label}</button>
                ))}
              </div>
              <button onClick={() => setPicking(false)} className='w-full text-center mt-3 text-sm text-gray-600'>Back</button>
            </>
          )}

          {error && <p className='text-red-600 text-sm mt-3'>{error}</p>}
        </div>
      </div>
    </div>
  )
}

export default Start
