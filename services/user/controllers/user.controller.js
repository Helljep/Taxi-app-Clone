const userModel = require('../models/user.model');
const userService = require('../services/user.service');
const { validationResult } = require('express-validator');
const blackListTokenModel = require('../models/blacklistToken.model');

module.exports.registerUser = async (req, res, next) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { fullname, email, password } = req.body;

    const isUserAlready = await userModel.findOne({ email });

    if (isUserAlready) {
        return res.status(400).json({ message: 'User already exist' });
    }

    const hashedPassword = await userModel.hashPassword(password);

    let user;
    try {
        user = await userService.createUser({
            firstname: fullname.firstname,
            lastname: fullname.lastname,
            email,
            password: hashedPassword
        });
    } catch (err) {
        // mongoose validation errors (eg. lastname too short) land here
        return res.status(400).json({ message: err.message });
    }

    const token = user.generateAuthToken();

    res.status(201).json({ token, user });


}

module.exports.loginUser = async (req, res, next) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await userModel.findOne({ email }).select('+password');

    if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = user.generateAuthToken();

    res.cookie('token', token);

    res.status(200).json({ token, user });
}

module.exports.getUserProfile = async (req, res, next) => {

    res.status(200).json(req.user);

}

// add money to the demo wallet (no real payment provider is involved)
module.exports.topUpWallet = async (req, res) => {
    const amount = Number(req.body.amount);

    if (!Number.isInteger(amount) || amount < 1 || amount > 10000) {
        return res.status(400).json({ message: 'Amount must be a whole number from 1 to 10000' });
    }

    const user = await userModel.findByIdAndUpdate(req.user._id, { $inc: { wallet: amount } }, { new: true });
    res.status(200).json({ wallet: user.wallet });
}

// internal: the ride service charges the wallet when a ride ends.
// The balance check and the deduction happen in ONE database operation, so two
// rides finishing at the same time can never spend the same money twice.
module.exports.chargeWallet = async (req, res) => {
    const { userId, amount } = req.body;

    if (!userId || !(amount > 0)) {
        return res.status(400).json({ message: 'userId and a positive amount are required' });
    }

    const user = await userModel.findOneAndUpdate(
        { _id: userId, wallet: { $gte: amount } },
        { $inc: { wallet: -amount } },
        { new: true }
    );

    if (!user) {
        return res.status(402).json({ message: 'Insufficient wallet balance' });
    }

    res.status(200).json({ wallet: user.wallet });
}

module.exports.logoutUser = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];
    res.clearCookie('token');

    await blackListTokenModel.create({ token });

    res.status(200).json({ message: 'Logged out' });

}