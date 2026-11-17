import React from 'react'

// "Street name" in bold, the rest of the address in grey, like the Uber app.
const Place = ({ text, label }) => {
    const [ title, ...rest ] = (text || '').split(',')
    return (
        <div className='min-w-0'>
            {label && <p className='text-xs font-medium uppercase tracking-wide text-[#6b6b6b]'>{label}</p>}
            <p className='truncate text-base font-medium'>{title || '—'}</p>
            {rest.length > 0 && <p className='truncate text-sm text-[#6b6b6b]'>{rest.join(',').trim()}</p>}
        </div>
    )
}

// pickup (dot) joined to destination (square) by a line
const RouteTimeline = ({ pickup, destination }) => (
    <div className='flex gap-4'>
        <div className='flex flex-col items-center py-2'>
            <span className='h-2.5 w-2.5 rounded-full bg-black' />
            <span className='my-1 w-px flex-1 bg-[#c8c8c8]' />
            <span className='h-2.5 w-2.5 bg-black' />
        </div>
        <div className='min-w-0 flex-1'>
            <Place text={pickup} label='Pickup' />
            <div className='my-3 h-px bg-[#eeeeee]' />
            <Place text={destination} label='Drop-off' />
        </div>
    </div>
)

export default RouteTimeline
