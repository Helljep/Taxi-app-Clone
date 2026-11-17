import React from 'react'

const LocationSearchPanel = ({ suggestions, activeField, setPickup, setDestination }) => {

    const handleSuggestionClick = (suggestion) => {
        if (activeField === 'pickup') {
            setPickup(suggestion)
        } else if (activeField === 'destination') {
            setDestination(suggestion)
        }
    }

    return (
        <div>
            {suggestions.map((elem, idx) => {
                // street or place name in bold, the rest in grey
                const [ title, ...rest ] = elem.split(',')
                return (
                    <button
                        key={idx}
                        type='button'
                        onClick={() => handleSuggestionClick(elem)}
                        className='flex w-full items-center gap-4 border-b border-[#f0f0f0] py-3.5 text-left active:bg-[#f6f6f6]'>
                        <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eeeeee]'>
                            <i className="ri-map-pin-fill text-lg"></i>
                        </span>
                        <span className='min-w-0'>
                            <span className='block truncate text-base font-medium'>{title}</span>
                            {rest.length > 0 && <span className='block truncate text-sm text-[#6b6b6b]'>{rest.join(',').trim()}</span>}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

export default LocationSearchPanel
