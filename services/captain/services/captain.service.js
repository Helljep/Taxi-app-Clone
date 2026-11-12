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


// radius is in km
module.exports.getCaptainsInTheRadius = async (ltd, lng, radius, vehicleType) => {

    const filter = {
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
