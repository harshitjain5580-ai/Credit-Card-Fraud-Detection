import mongoose from "mongoose";

export async function connectDatabase(uri) {
  try {
    await mongoose.connect(uri);
    console.info("Connected to MongoDB.");
    return mongoose.connection;
  } catch (error) {
    console.error("Failed to connect to MongoDB.", {
      errorType: error?.name || "Error",
    });
    throw error;
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
