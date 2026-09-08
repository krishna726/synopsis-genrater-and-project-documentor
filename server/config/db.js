const mongoose = require('mongoose');

// Disable Mongoose's 10-second operation buffering timeout
mongoose.set('bufferCommands', false);

let cached = global.mongoose || (global.mongoose = { conn: null, promise: null });

async function connectDatabase() {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.warn('MongoDB URI is not configured.');
    return null;
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 5000,
      })
      .then((m) => {
        console.log('MongoDB connected successfully');
        return m;
      })
      .catch((err) => {
        cached.promise = null;
        console.error('MongoDB connection failed:', err.message);
        return null;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = connectDatabase;
