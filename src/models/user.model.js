
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    telegramId: {
        type: Number,
        required: true,
        unique: true,
        index: true,
    },
    firstName: {
        type: String,
    },
    smartshellLogin: {
        type: String,
        required: true,
    },
    accessToken: {
        type: String,
        required: true,
    },
    refreshToken: {
        type: String,
        required: true,
    },
    clubId: {
        type: Number,
        required: true,
    },
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

export default User;