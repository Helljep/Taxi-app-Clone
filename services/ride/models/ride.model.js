const mongoose = require('mongoose');


// The user and captain live in other services (other databases), so a ride
// only keeps their ids plus a small copy of the details the screens need.
const rideSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    userInfo: {
        fullname: {
            firstname: String,
            lastname: String
        }
    },
    captain: {
        type: mongoose.Schema.Types.ObjectId,
    },
    captainInfo: {
        fullname: {
            firstname: String,
            lastname: String
        },
        vehicle: {
            color: String,
            plate: String,
            vehicleType: String
        }
    },
    pickup: {
        type: String,
        required: true,
    },
    destination: {
        type: String,
        required: true,
    },
    fare: {
        type: Number,
        required: true,
    },

    surgeMultiplier: {
        type: Number,
        default: 1,
    }, // 1 = normal price

    vehicleType: {
        type: String,
        enum: [ 'auto', 'car', 'moto' ],
    },

    // where the pickup is, needed to find and rank nearby captains
    pickupCoordinates: {
        ltd: Number,
        lng: Number,
    },

    // captains this ride was already offered to (dispatch never offers twice)
    offeredTo: [ { type: mongoose.Schema.Types.ObjectId } ],

    // the one captain who may accept this ride right now
    currentOffer: { type: mongoose.Schema.Types.ObjectId },

    paymentMethod: {
        type: String,
        enum: [ 'cash', 'wallet' ],
        default: 'cash',
    },
    paymentStatus: {
        type: String,
        enum: [ 'pending', 'paid', 'cash-due' ],  // cash-due = wallet was short, pay the captain in cash
        default: 'pending',
    },

    cancelledBy: {
        type: String,
        enum: [ 'user', 'captain', 'system' ],
    },

    // the rider's rating of the captain, filled in after the ride
    rating: {
        score: { type: Number, min: 1, max: 5 },
        comment: String,
    },

    status: {
        type: String,
        enum: [ 'pending', 'accepted', "ongoing", 'completed', 'cancelled' ],
        default: 'pending',
    },

    duration: {
        type: Number,
    }, // in seconds

    distance: {
        type: Number,
    }, // in meters

    otp: {
        type: String,
        select: false,
        required: true,
    },
}, {
    timestamps: true
})

// The database itself guarantees one open ride per rider and per captain, so two
// requests arriving at the same moment can't both succeed.
const OPEN = { $in: [ 'pending', 'accepted', 'ongoing' ] };
rideSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { status: OPEN } });
rideSchema.index({ captain: 1 }, { unique: true, partialFilterExpression: { status: { $in: [ 'accepted', 'ongoing' ] } } });

// Indexes for the queries that run on every request. Without them MongoDB reads EVERY ride
// ever created each time (found in load testing: ~30 ms per request at 16,000 rides, growing forever).
rideSchema.index({ user: 1, status: 1, updatedAt: -1 });  // "how many rides did this rider cancel lately"
rideSchema.index({ status: 1, updatedAt: 1 });            // the repair job: pending rides not touched lately
rideSchema.index({ user: 1, createdAt: -1 });             // rider history
rideSchema.index({ captain: 1, createdAt: -1 });          // captain history

module.exports = mongoose.model('ride', rideSchema);
