const captainModel = require('../models/captain.model');


module.exports.createCaptain = async ({
    firstname, lastname, email, password, color, plate, capacity, vehicleType
}) => {
    if (!firstname || !email || !password || !color || !plate || !capacity || !vehicleType) {
        throw new Error('All fields are required');
    }
    const captain = captainModel.create({
        fullname: {
            firstname,
            lastname
        },
        email,
        password,
        vehicle: {
            color,
            plate,
            capacity,
            vehicleType
        }
    })

    return captain;
}


// called every time the realtime service reports a new captain position
module.exports.updateLocation = async (captainId, ltd, lng) => {
    await captainModel.findByIdAndUpdate(captainId, {
        location: {
            type: 'Point',
            coordinates: [ lng, ltd ]
        }
    });
}


module.exports.setStatus = async (captainId, status) => {
    return await captainModel.findByIdAndUpdate(captainId, { status }, { new: true });
}


module.exports.addRating = async (captainId, rating) => {
    return await captainModel.findByIdAndUpdate(captainId, {
        $inc: { 'rating.sum': rating, 'rating.count': 1 }
    }, { new: true });
}


// called when a ride is finished and paid
module.exports.addEarnings = async (captainId, amount) => {
    return await captainModel.findByIdAndUpdate(captainId, {
        $inc: { earnings: amount, ridesCompleted: 1 }
    }, { new: true });
}


// radius is in km
module.exports.getCaptainsInTheRadius = async (ltd, lng, radius, vehicleType) => {

    // only captains who are online
    const filter = {
        status: 'active',
        location: {
            $geoWithin: {
                $centerSphere: [ [ lng, ltd ], radius / 6371 ]
            }
        }
    };

    if (vehicleType) {
        filter[ 'vehicle.vehicleType' ] = vehicleType;
    }

    return await captainModel.find(filter);
}
