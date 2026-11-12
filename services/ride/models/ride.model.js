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

module.exports = mongoose.model('ride', rideSchema);
