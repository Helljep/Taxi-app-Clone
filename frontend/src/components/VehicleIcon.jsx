import React from 'react'

// Simple flat drawings, so the app does not depend on pictures hosted on other websites.
const wheel = (cx, cy, r = 7) => (
    <g>
        <circle cx={cx} cy={cy} r={r} fill='#111' stroke='#fff' strokeWidth='2' />
        <circle cx={cx} cy={cy} r={r / 2.3} fill='#9a9a9a' />
    </g>
)

const VehicleIcon = ({ type, className = 'h-12 w-16' }) => (
    <svg viewBox='0 0 96 48' className={className} aria-hidden='true'>
        {type === 'moto' ? (
            <g>
                <circle cx='20' cy='35' r='9' fill='none' stroke='#111' strokeWidth='3.5' />
                <circle cx='76' cy='35' r='9' fill='none' stroke='#111' strokeWidth='3.5' />
                <path d='M20 35 L36 23 H54 L76 35' fill='none' stroke='#111' strokeWidth='3.5' strokeLinejoin='round' />
                <path d='M34 22 Q45 12 60 21 Z' fill='#111' />
                <rect x='28' y='19' width='16' height='4' rx='2' fill='#444' />
                <path d='M62 14 L72 12 M66 13 L72 33' stroke='#111' strokeWidth='3.5' strokeLinecap='round' fill='none' />
            </g>
        ) : type === 'auto' ? (
            <g>
                <path d='M12 36 V20 Q12 12 20 11 H58 Q64 11 67 17 L74 28 Q78 30 78 34 V36 Z' fill='#111' />
                <path d='M20 15 H44 V27 H18 Z' fill='#d9d9d9' />
                <path d='M48 15 H58 L64 27 H48 Z' fill='#d9d9d9' />
                {wheel(26, 37)}
                {wheel(64, 37)}
            </g>
        ) : (
            <g>
                <path d='M8 36 V28 Q8 23 13 22 L26 20 L36 11 Q38 9 42 9 H62 Q65 9 67 11 L75 20 L85 22 Q90 23 90 28 V36 Z' fill='#111' />
                <path d='M39 12 H48 V20 H30 Z' fill='#d9d9d9' />
                <path d='M52 12 H61 L69 20 H52 Z' fill='#d9d9d9' />
                {wheel(27, 37)}
                {wheel(71, 37)}
            </g>
        )}
    </svg>
)

export default VehicleIcon
