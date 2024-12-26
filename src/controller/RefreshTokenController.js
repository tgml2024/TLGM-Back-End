const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";
const REFRESH_TOKEN_SECRET =
    process.env.REFRESH_TOKEN_SECRET || "your_refresh_token_secret";

const refreshToken = (req, res) => {
    const { refreshToken } = req.cookies;

    if (!refreshToken) {
        return res.status(401).json({ message: "Refresh token is missing" });
    }

    try {
        const user = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);

        const newAccessToken = jwt.sign(
            { userId: user.userId, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '15m' }
        );

        res.cookie("accessToken", newAccessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "none",
            maxAge: 15 * 60 * 1000,
            path: "/",
            expires: new Date(Date.now() + 15 * 60 * 1000)
        });

        return res
            .status(200)
            .json({ message: "Access token refreshed", accessToken: newAccessToken });
    } catch (error) {
        console.error(error);
        return res.status(403).json({ message: "Invalid refresh token" });
    }
};

module.exports = {
    refreshToken
};
