import mongoose from "mongoose"


const userSchema = new mongoose.Schema({
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
    },
    accessToken: {
        type: String,
    },
    clubId: {
        type: Number,
        required: true,
    }
});

const User = mongoose.model('User', userSchema);

export default User;